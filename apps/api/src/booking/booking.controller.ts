import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { uuid } from "../contracts.js";
import { BookingService } from "./booking.service.js";
import type { BookingSettings } from "../../../../packages/contracts/src/booking.js";

// Dönüş tipleri açık yazılır: API bildirim dosyası (declaration) ürettiği
// için çıkarsanan tip, sözleşme paketine symlink'li node_modules yolundan
// adlandırılamıyor (TS2742).
type Settings = Promise<{ data: BookingSettings }>;

/** Öğrencinin boş saatten ders ayarlaması. ApiController'daki
 *  `workspaces/:ws/:resource` ucundan önce kaydedilir (app.module.ts). */
@Controller("v1")
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly booking: BookingService) {}
  @Get("workspaces/:ws/booking") settings(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
  ): Settings {
    return this.booking.settings(req.actor, uuid.parse(ws));
  }
  @Put("workspaces/:ws/booking") save(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Body() body: unknown,
  ): Settings {
    return this.booking.saveSettings(req.actor, uuid.parse(ws), body);
  }
}
