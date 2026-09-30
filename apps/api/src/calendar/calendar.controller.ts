import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { CalendarService } from "./calendar.service.js";

/** Takvim uygulamasının okuduğu akış: oturum yok, bağlantıdaki belirteç yeter. */
@Controller("v1/calendar")
export class CalendarFeedController {
  constructor(private readonly calendar: CalendarService) {}
  @Get(":token") async feed(
    @Param("token") token: string,
    @Res() res: Response,
  ) {
    const body = await this.calendar.ics(token);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-cache");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex");
    res.end(body);
  }
}

/** Kişinin kendi takvim bağlantısı. */
@Controller("v1/calendar")
@UseGuards(AuthGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}
  @Post() feed(@Req() req: ActorRequest) {
    return this.calendar.feed(req.actor);
  }
  @Post("rotate") rotate(@Req() req: ActorRequest) {
    return this.calendar.rotate(req.actor);
  }
}
