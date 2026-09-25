import {
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../auth/auth.guard.js";
import { CONFIG, type ApiConfig } from "../config.js";
import { DatabaseService } from "../db/database.service.js";
import { toDto } from "../common/command.service.js";

@Injectable()
export class BillingProvider {
  constructor(@Inject(CONFIG) readonly config: ApiConfig) {}
  ready() {
    return !!(
      this.config.LEMONSQUEEZY_API_KEY &&
      this.config.LEMONSQUEEZY_STORE_ID &&
      this.config.LEMONSQUEEZY_VARIANT_ID &&
      this.config.LEMONSQUEEZY_WEBHOOK_SECRET
    );
  }
  async call<T>(path: string, body?: unknown): Promise<T> {
    if (!this.ready())
      throw new ServiceUnavailableException(
        "Abonelik ödemeleri henüz açılmamış.",
      );
    const r = await fetch("https://api.lemonsqueezy.com/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.config.LEMONSQUEEZY_API_KEY}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok)
      throw new ServiceUnavailableException(
        "Abonelik hizmetine ulaşılamadı. Yeniden deneyin.",
      );
    return (await r.json()) as T;
  }
  url(value: string) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".lemonsqueezy.com")
    )
      throw new ServiceUnavailableException("Ödeme adresi doğrulanamadı.");
    return url.href;
  }
}
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly provider: BillingProvider,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}
  async get(actor: Actor, ws: string) {
    return this.db.transaction(actor, ws, async (tx) => {
      const row = (
        await tx.query(
          "SELECT provider_id,status,ends_at,renews_at FROM derslik.subscriptions WHERE workspace_id=$1",
          [ws],
        )
      ).rows[0] || { status: "none" };
      return {
        data: {
          ...(toDto(row) as Record<string, unknown>),
          available: this.provider.ready(),
          pro: { students: 100, videoHours: 50, materialGb: 2 },
          testMode: this.config.LEMONSQUEEZY_TEST_MODE === "true",
        },
      };
    });
  }
  async checkout(actor: Actor, ws: string) {
    if (!this.provider.ready())
      throw new ServiceUnavailableException(
        "Abonelik ödemeleri henüz açılmamış.",
      );
    const state = await this.db.transaction(actor, ws, async (tx) => {
      await tx.query(
        "INSERT INTO derslik.subscriptions(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
        [ws],
      );
      const row = (
        await tx.query(
          "SELECT * FROM derslik.subscriptions WHERE workspace_id=$1 FOR UPDATE",
          [ws],
        )
      ).rows[0];
      if (row.provider_id) return { portal: true };
      if (row.checkout_url && row.checkout_expires_at > new Date())
        return { url: row.checkout_url };
      if (row.preparing_at && Date.now() - row.preparing_at.getTime() < 30000)
        throw new ConflictException(
          "Ödeme sayfası hazırlanıyor. Biraz sonra yeniden deneyin.",
        );
      await tx.query(
        "UPDATE derslik.subscriptions SET preparing_at=now() WHERE workspace_id=$1",
        [ws],
      );
      return { billingKey: row.billing_key };
    });
    if (state.portal) return this.portal(actor, ws);
    if (state.url) return { data: { url: state.url } };
    const expires = new Date(Date.now() + 30 * 60000).toISOString();
    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          test_mode: this.config.LEMONSQUEEZY_TEST_MODE === "true",
          expires_at: expires,
          product_options: {
            enabled_variants: [Number(this.config.LEMONSQUEEZY_VARIANT_ID)],
            redirect_url: this.config.WEB_ORIGIN + "/?billing=return",
          },
          checkout_options: { locale: "tr" },
          checkout_data: {
            ...(actor.email ? { email: actor.email } : {}),
            custom: { billing_key: state.billingKey },
          },
        },
        relationships: {
          store: {
            data: { type: "stores", id: this.config.LEMONSQUEEZY_STORE_ID },
          },
          variant: {
            data: { type: "variants", id: this.config.LEMONSQUEEZY_VARIANT_ID },
          },
        },
      },
    };
    const result = await this.provider.call<{
        data: { attributes: { url: string } };
      }>("/checkouts", payload),
      url = this.provider.url(result.data.attributes.url);
    await this.db.transaction(actor, ws, async (tx) => {
      await tx.query(
        "UPDATE derslik.subscriptions SET checkout_url=$2,checkout_expires_at=$3,preparing_at=NULL WHERE workspace_id=$1",
        [ws, url, expires],
      );
    });
    return { data: { url } };
  }
  async portal(actor: Actor, ws: string) {
    const row = await this.db.transaction(
      actor,
      ws,
      async (tx) =>
        (
          await tx.query(
            "SELECT provider_id FROM derslik.subscriptions WHERE workspace_id=$1",
            [ws],
          )
        ).rows[0],
    );
    if (!row?.provider_id)
      throw new ConflictException("Etkin abonelik bulunamadı.");
    const result = await this.provider.call<{
      data: { attributes: { urls: { customer_portal: string } } };
    }>("/subscriptions/" + encodeURIComponent(row.provider_id));
    return {
      data: {
        url: this.provider.url(result.data.attributes.urls.customer_portal),
      },
    };
  }
  async sync(actor: Actor, ws: string) {
    const row = await this.db.transaction(
      actor,
      ws,
      async (tx) =>
        (
          await tx.query(
            "SELECT provider_id,billing_key FROM derslik.subscriptions WHERE workspace_id=$1",
            [ws],
          )
        ).rows[0],
    );
    if (row?.provider_id) {
      const result = await this.provider.call<{ data: unknown }>(
        "/subscriptions/" + encodeURIComponent(row.provider_id),
      );
      await this.apply({
        data: result.data,
        meta: { custom_data: { billing_key: row.billing_key } },
      });
    }
    return this.get(actor, ws);
  }
  async webhook(signature: string | undefined, raw: Buffer | undefined) {
    const secret = this.config.LEMONSQUEEZY_WEBHOOK_SECRET;
    if (!secret || !raw || !/^[a-f0-9]{64}$/.test(signature || ""))
      throw new UnauthorizedException();
    if (
      !timingSafeEqual(
        createHmac("sha256", secret).update(raw).digest(),
        Buffer.from(signature!, "hex"),
      )
    )
      throw new UnauthorizedException();
    const event = JSON.parse(raw.toString());
    if (event.data?.type !== "subscriptions") return { received: true };
    // Re-fetch canonical state: delayed/replayed events cannot restore old privileges.
    const id = z.string().regex(/^\d+$/).parse(String(event.data.id));
    const current = await this.provider.call<{ data: unknown }>(
      "/subscriptions/" + id,
    );
    return this.apply({ data: current.data, meta: event.meta });
  }
  private async apply(input: unknown) {
    const e = z
      .object({
        meta: z
          .object({
            custom_data: z
              .object({ billing_key: z.string().uuid().optional() })
              .optional(),
          })
          .passthrough(),
        data: z.object({
          type: z.literal("subscriptions"),
          id: z.string().regex(/^\d+$/),
          attributes: z
            .object({
              store_id: z.number(),
              variant_id: z.number(),
              status: z.enum([
                "active",
                "on_trial",
                "cancelled",
                "expired",
                "past_due",
                "unpaid",
                "paused",
              ]),
              test_mode: z.boolean(),
              updated_at: z.string().datetime({ offset: true }),
              ends_at: z.string().datetime({ offset: true }).nullable(),
              renews_at: z.string().datetime({ offset: true }).nullable(),
            })
            .passthrough(),
        }),
      })
      .parse(input);
    const a = e.data.attributes;
    if (
      String(a.store_id) !== this.config.LEMONSQUEEZY_STORE_ID ||
      String(a.variant_id) !== this.config.LEMONSQUEEZY_VARIANT_ID ||
      a.test_mode !== (this.config.LEMONSQUEEZY_TEST_MODE === "true")
    )
      throw new UnauthorizedException("Abonelik ürünü veya ortamı eşleşmiyor.");
    const mapping = (
      await this.db.pool.query(
        "SELECT * FROM derslik.subscription_owner($1,$2)",
        [e.meta.custom_data?.billing_key || null, e.data.id],
      )
    ).rows;
    if (mapping.length !== 1)
      throw new ConflictException("Abonelik çalışma alanıyla eşleştirilemedi.");
    const { workspace_id: ws, owner_id: owner } = mapping[0],
      hash = createHash("sha256").update(JSON.stringify(e.data)).digest("hex");
    return this.db.transaction({ id: owner }, ws, async (tx) => {
      const old = (
        await tx.query(
          "SELECT * FROM derslik.subscriptions WHERE workspace_id=$1 FOR UPDATE",
          [ws],
        )
      ).rows[0];
      if (old.provider_id && old.provider_id !== e.data.id)
        throw new ConflictException(
          "Bu çalışma alanında farklı bir abonelik var.",
        );
      if (
        old.provider_updated_at &&
        old.provider_updated_at > new Date(a.updated_at)
      )
        return { received: true };
      const inserted = await tx.query(
        "INSERT INTO derslik.subscription_events(workspace_id,hash,provider_id) VALUES($1,$2,$3) ON CONFLICT(hash) DO NOTHING RETURNING id",
        [ws, hash, e.data.id],
      );
      // Entitlement expiry is evaluated even when polling unchanged provider state.
      const pro =
        ["active", "on_trial"].includes(a.status) ||
        (a.status === "cancelled" &&
          !!a.ends_at &&
          new Date(a.ends_at) > new Date());
      if (inserted.rowCount)
        await tx.query(
          "UPDATE derslik.subscriptions SET provider_id=$2,status=$3,provider_updated_at=$4,ends_at=$5,renews_at=$6,checkout_url=NULL,checkout_expires_at=NULL WHERE workspace_id=$1",
          [ws, e.data.id, a.status, a.updated_at, a.ends_at, a.renews_at],
        );
      await tx.query(
        "INSERT INTO derslik.workspace_limits(workspace_id,plan,student_limit,video_seconds,material_bytes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET plan=EXCLUDED.plan,student_limit=EXCLUDED.student_limit,video_seconds=EXCLUDED.video_seconds,material_bytes=EXCLUDED.material_bytes",
        [
          ws,
          pro ? "PRO" : "PILOT",
          pro ? 100 : 30,
          pro ? 180000 : 36000,
          pro ? 2147483648 : 209715200,
        ],
      );
      return { received: true };
    });
  }
}
