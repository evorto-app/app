import { getId } from '../get-id';

export const getCityTourTemplates = (cityToursCategory: { id: string; tenantId: string }) => [
  {
    categoryId: cityToursCategory.id,
    description:
      '<h2>Tour of Murnau</h2><p>Explore the charming town of Murnau with our guided city tour. Discover its rich history and beautiful architecture.</p><ul><li>Duration: 2 hours</li><li>Meeting Point: Murnau Town Hall</li></ul>',
    icon: 'city',
    id: getId(),
    tenantId: cityToursCategory.tenantId,
    title: 'Murnau City Tour',
  },
  {
    categoryId: cityToursCategory.id,
    description:
      '<h2>Tour of Munich</h2><p>Join us for a day trip to Munich. Visit famous landmarks and enjoy the vibrant city life.</p><ul><li>Duration: 6 hours</li><li>Meeting Point: Munich Central Station</li></ul>',
    icon: 'munich-cathedral:color',
    id: getId(),
    tenantId: cityToursCategory.tenantId,
    title: 'Munich City Tour',
  },
  {
    categoryId: cityToursCategory.id,
    description:
      '<h2>Tour of Garmisch-Partenkirchen</h2><p>Discover the beauty of Garmisch-Partenkirchen with our guided tour. Learn about its history and enjoy the stunning scenery.</p><ul><li>Duration: 3 hours</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'city',
    id: getId(),
    tenantId: cityToursCategory.tenantId,
    title: 'Garmisch-Partenkirchen City Tour',
  },
];
