import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
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
  @Get("portal/:ws/:student/booking/slots") slots(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
  ) {
    return this.booking.slots(req.actor, uuid.parse(ws), uuid.parse(student));
  }
  @Post("portal/:ws/:student/booking") book(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.booking.book(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      key,
      body,
    );
  }
  @Post("portal/:ws/:student/booking/:lesson/cancel") cancel(
    @Req() req: ActorRequest,
    @Param("ws") ws: string,
    @Param("student") student: string,
    @Param("lesson") lesson: string,
    @Headers("idempotency-key") key: string,
    @Body() body: unknown,
  ) {
    return this.booking.cancel(
      req.actor,
      uuid.parse(ws),
      uuid.parse(student),
      uuid.parse(lesson),
      key,
      body,
    );
  }
}
