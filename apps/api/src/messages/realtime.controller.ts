import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard, type ActorRequest } from "../auth/auth.guard.js";
import { RealtimeService } from "./realtime.service.js";

/** Anlık mesajlaşma soketinin bileti. Soket `/v1/socket` adresindedir ve
 *  bileti `ticket.<bilet>` alt protokolüyle alır (RealtimeService). */
@Controller("v1/socket")
@UseGuards(AuthGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}
  @Post("ticket") ticket(@Req() req: ActorRequest) {
    return this.realtime.ticket(req.actor);
  }
}
