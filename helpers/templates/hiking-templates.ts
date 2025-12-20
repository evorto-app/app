import { getId } from '../get-id';

export const getHikingTemplates = (hikingCategory: { id: string; tenantId: string }) => [
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Hörnle</h2><p>Join us for an exhilarating hike to the Hörnle. Enjoy breathtaking views and fresh mountain air. Don’t forget to bring your camera!</p><ul><li>Duration: 4 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Murnau Train Station</li></ul>',
    icon: 'alps',
    id: getId(),
    location: {
      address: '82418 Murnau am Staffelsee, Germany',
      coordinates: {
        lat: 47.682_852,
        lng: 11.193_08,
      },
      name: 'Bahnhof, Murnau a. Staffelsee',
      placeId: 'ChIJj-c4NCWunUcRarPf2welrJU',
      type: 'google',
    },
    tenantId: hikingCategory.tenantId,
    title: 'Hörnle hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Zugspitze</h2><p>Experience the thrill of hiking to the highest peak in Germany. This challenging hike is perfect for adventure seekers.</p><ul><li>Duration: 8 hours</li><li>Difficulty: Hard</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Zugspitze hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Alpspitze</h2><p>Join us for a scenic hike to the Alpspitze. Enjoy panoramic views and a rewarding climb.</p><ul><li>Duration: 6 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Alpspitze hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Partnach Gorge</h2><p>Explore the stunning Partnach Gorge with us. This easy hike is perfect for nature lovers.</p><ul><li>Duration: 2 hours</li><li>Difficulty: Easy</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'valley:color',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Partnach Gorge hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Eibsee</h2><p>Join us for a relaxing hike to the beautiful Eibsee. Enjoy the crystal-clear waters and scenic views.</p><ul><li>Duration: 3 hours</li><li>Difficulty: Easy</li><li>Meeting Point: Grainau Train Station</li></ul>',
    icon: 'lake',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Eibsee hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Wank</h2><p>Join us for a hike to the Wank. Enjoy panoramic views of the surrounding mountains.</p><ul><li>Duration: 5 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Wank hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Kramer</h2><p>Join us for a challenging hike to the Kramer. Enjoy breathtaking views and a rewarding climb.</p><ul><li>Duration: 6 hours</li><li>Difficulty: Hard</li><li>Meeting Point: Garmisch-Partenkirchen Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Kramer hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Herzogstand</h2><p>Join us for a hike to the Herzogstand. Enjoy stunning views of the surrounding lakes and mountains.</p><ul><li>Duration: 4 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Kochel Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Herzogstand hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Benediktenwand</h2><p>Join us for a hike to the Benediktenwand. Enjoy the beautiful scenery and fresh mountain air.</p><ul><li>Duration: 5 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Benediktbeuern Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Benediktenwand hike',
  },
  {
    categoryId: hikingCategory.id,
    description:
      '<h2>Hike to the Jochberg</h2><p>Join us for a hike to the Jochberg. Enjoy stunning views of the Kochelsee and Walchensee.</p><ul><li>Duration: 4 hours</li><li>Difficulty: Moderate</li><li>Meeting Point: Kochel Train Station</li></ul>',
    icon: 'mountain',
    id: getId(),
    tenantId: hikingCategory.tenantId,
    title: 'Jochberg hike',
  },
];
