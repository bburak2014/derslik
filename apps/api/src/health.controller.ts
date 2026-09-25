import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseService } from "./db/database.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get("live")
  live() {
    return { status: "ok" };
  }
  @Get("ready")
  async ready() {
    try {
      await this.database.pool.query(
        "SELECT 1 FROM derslik.workspaces LIMIT 0",
      );
      return { status: "ok" };
    } catch {
      throw new ServiceUnavailableException("api.databaseNotReady");
    }
  }
}
