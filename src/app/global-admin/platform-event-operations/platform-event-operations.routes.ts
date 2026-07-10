import { Routes } from '@angular/router';

export const PLATFORM_EVENT_OPERATION_ROUTES: Routes = [
  {
    loadComponent: () =>
      import('./platform-event-create.component').then(
        (module) => module.PlatformEventCreateComponent,
      ),
    path: 'tenants/:tenantId/events/new',
  },
  {
    loadComponent: () =>
      import('./platform-event-detail.component').then(
        (module) => module.PlatformEventDetailComponent,
      ),
    path: 'tenants/:tenantId/events/:eventId',
  },
  {
    loadComponent: () =>
      import('./platform-events.component').then(
        (module) => module.PlatformEventsComponent,
      ),
    path: 'tenants/:tenantId/events',
  },
  {
    loadComponent: () =>
      import('./platform-template-editor.component').then(
        (module) => module.PlatformTemplateEditorComponent,
      ),
    path: 'tenants/:tenantId/templates/new',
  },
  {
    loadComponent: () =>
      import('./platform-template-editor.component').then(
        (module) => module.PlatformTemplateEditorComponent,
      ),
    path: 'tenants/:tenantId/templates/:templateId',
  },
  {
    loadComponent: () =>
      import('./platform-templates.component').then(
        (module) => module.PlatformTemplatesComponent,
      ),
    path: 'tenants/:tenantId/templates',
  },
  {
    loadComponent: () =>
      import('./platform-scanner.component').then(
        (module) => module.PlatformScannerComponent,
      ),
    path: 'tenants/:tenantId/scanner/:registrationId',
  },
  {
    loadComponent: () =>
      import('./platform-scanner.component').then(
        (module) => module.PlatformScannerComponent,
      ),
    path: 'tenants/:tenantId/scanner',
  },
];
