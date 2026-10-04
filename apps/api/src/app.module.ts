import { Module, type DynamicModule } from "@nestjs/common";
import { CONFIG, type ApiConfig } from "./config.js";
import { DatabaseService } from "./db/database.service.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { CommandService } from "./common/command.service.js";
import { WorkspacesService } from "./workspaces/workspaces.service.js";
import { QueriesService } from "./workspaces/queries.service.js";
import { StudentsService } from "./students/students.service.js";
import { LessonsService } from "./lessons/lessons.service.js";
import { LessonRemindersService } from "./lessons/reminders.service.js";
import { LessonBoardController } from "./lessons/lesson-board.controller.js";
import { LessonBoardService } from "./lessons/lesson-board.service.js";
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
import {
  DirectoryController,
  PublicDirectoryController,
} from "./directory/directory.controller.js";
import { DirectoryService } from "./directory/directory.service.js";
import {
  CalendarController,
  CalendarFeedController,
} from "./calendar/calendar.controller.js";
import { CalendarService } from "./calendar/calendar.service.js";
import { MessagesController } from "./messages/messages.controller.js";
import { MessagesService } from "./messages/messages.service.js";
import { RealtimeController } from "./messages/realtime.controller.js";
import { RealtimeService } from "./messages/realtime.service.js";
import { BookingController } from "./booking/booking.controller.js";
import { BookingService } from "./booking/booking.service.js";
@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      // Routes match in registration order. ApiController ends with the
      // catch-all GET workspaces/:ws/:resource, so it goes last; placed first
      // it answered GET workspaces/:ws/subscription with a 400.
      controllers: [
        HealthController,
        LearningController,
        MediaController,
        MediaCapabilitiesController,
        StreamWebhookController,
        SubscriptionController,
        SubscriptionWebhookController,
        PublicDirectoryController,
        DirectoryController,
        CalendarFeedController,
        CalendarController,
        MessagesController,
        RealtimeController,
        BookingController,
        LessonBoardController,
        ApiController,
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
        LessonRemindersService,
        LessonBoardService,
        CalendarService,
        BillingService,
        SnapshotService,
        LearningService,
        AccessService,
        MailService,
        MediaProviders,
        MediaService,
        BillingProvider,
        SubscriptionService,
        DirectoryService,
        MessagesService,
        RealtimeService,
        BookingService,
      ],
    };
  }
}
