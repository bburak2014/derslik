import { Module, type DynamicModule } from "@nestjs/common";
import { CONFIG, type ApiConfig } from "./config.js";
import { DatabaseService } from "./db/database.service.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { CommandService } from "./common/command.service.js";
import { WorkspacesService } from "./workspaces/workspaces.service.js";
import { QueriesService } from "./workspaces/queries.service.js";
import { StudentsService } from "./students/students.service.js";
import { LessonsService } from "./lessons/lessons.service.js";
import { BillingService } from "./billing/billing.service.js";
import { ApiController } from "./api.controller.js";
import { HealthController } from "./health.controller.js";

import { SnapshotService } from "./workspaces/snapshot.service.js";
import { LearningService } from "./learning/learning.service.js";
import { AccessService } from "./access/access.service.js";
import { MailService } from "./access/mail.js";
import { LearningController } from "./learning/learning.controller.js";
import { MediaProviders } from "./media/providers.js";
import { MediaService } from "./media/media.service.js";
import {
  MediaController,
  MediaCapabilitiesController,
  StreamWebhookController,
} from "./media/media.controller.js";
import {
  BillingProvider,
  SubscriptionService,
} from "./subscriptions/subscription.service.js";
import {
  SubscriptionController,
  SubscriptionWebhookController,
} from "./subscriptions/subscription.controller.js";
@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        ApiController,
        HealthController,
        LearningController,
        MediaController,
        MediaCapabilitiesController,
        StreamWebhookController,
        SubscriptionController,
        SubscriptionWebhookController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        DatabaseService,
        AuthGuard,
        CommandService,
        WorkspacesService,
        QueriesService,
        StudentsService,
        LessonsService,
        BillingService,
        SnapshotService,
        LearningService,
        AccessService,
        MailService,
        MediaProviders,
        MediaService,
        BillingProvider,
        SubscriptionService,
      ],
    };
  }
}
