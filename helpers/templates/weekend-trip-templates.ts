import { getId } from '../get-id';

export const getWeekendTripTemplates = (weekendTripsCategory: {
  id: string;
  tenantId: string;
}) => [
  {
    categoryId: weekendTripsCategory.id,
    description:
      '<h2>Weekend trip to the Bavarian Forest</h2><p>Join us for a relaxing weekend trip to the Bavarian Forest. Enjoy the beautiful scenery and fresh air.</p><ul><li>Duration: 2 days</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'suitcase',
    id: getId(),
    tenantId: weekendTripsCategory.tenantId,
    title: 'Bavarian Forest Trip',
  },
  {
    categoryId: weekendTripsCategory.id,
    description:
      '<h2>Weekend trip to the Black Forest</h2><p>Join us for a relaxing weekend trip to the Black Forest. Enjoy the beautiful scenery and fresh air.</p><ul><li>Duration: 2 days</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'suitcase',
    id: getId(),
    tenantId: weekendTripsCategory.tenantId,
    title: 'Black Forest Trip',
  },
  {
    categoryId: weekendTripsCategory.id,
    description:
      '<h2>Weekend trip to the Harz Mountains</h2><p>Join us for a relaxing weekend trip to the Harz Mountains. Enjoy the beautiful scenery and fresh air.</p><ul><li>Duration: 2 days</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'suitcase',
    id: getId(),
    tenantId: weekendTripsCategory.tenantId,
    title: 'Harz Mountains Trip',
  },
];
