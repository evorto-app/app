import { getId } from '../get-id';

export const getCityTripTemplates = (cityTripsCategory: {
  id: string;
  tenantId: string;
}) => [
  {
    categoryId: cityTripsCategory.id,
    description:
      '<h2>Trip to Augsburg</h2><p>Join us for a trip to the historic city of Augsburg. Explore its rich history and beautiful architecture.</p><ul><li>Duration: 1 day</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'bus',
    id: getId(),
    planningTips:
      '<h3>Planning Tips</h3><ul><li>Coordinate with local guides for an informative tour.</li><li>Ensure participants have comfortable walking shoes.</li><li>Plan for a break at a local café or park.</li></ul>',
    tenantId: cityTripsCategory.tenantId,
    title: 'Augsburg Trip',
  },
  {
    categoryId: cityTripsCategory.id,
    description:
      '<h2>Trip to Nuremberg</h2><p>Join us for a trip to the historic city of Nuremberg. Visit famous landmarks and enjoy the vibrant city life.</p><ul><li>Duration: 1 day</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'bus',
    id: getId(),
    planningTips:
      '<h3>Planning Tips</h3><ul><li>Plan the itinerary to include major landmarks and attractions.</li><li>Ensure participants have a map and emergency contact information.</li><li>Schedule free time for participants to explore on their own.</li></ul>',
    tenantId: cityTripsCategory.tenantId,
    title: 'Nuremberg Trip',
  },
  {
    categoryId: cityTripsCategory.id,
    description:
      '<h2>Trip to Regensburg</h2><p>Join us for a trip to the historic city of Regensburg. Explore its rich history and beautiful architecture.</p><ul><li>Duration: 1 day</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'bus',
    id: getId(),
    tenantId: cityTripsCategory.tenantId,
    title: 'Regensburg Trip',
  },
];
