import { getId } from '../get-id';

export const getSportsTemplates = (sportsCategory: { id: string; tenantId: string }) => [
  {
    categoryId: sportsCategory.id,
    description:
      '<h2>Soccer Match</h2><p>Join us for an exciting soccer match. Cheer for your favorite team and enjoy the game.</p><ul><li>Duration: 2 hours</li><li>Meeting Point: Murnau Sports Complex</li></ul>',
    icon: 'football2',
    id: getId(),
    tenantId: sportsCategory.tenantId,
    title: 'Soccer Match',
    planningTips:
      '<h3>Planning Tips</h3><ul><li>Coordinate with local sports clubs for venue and equipment.</li><li>Ensure participants have appropriate sports attire.</li><li>Plan for refreshments and first aid.</li></ul>',
  },
  {
    categoryId: sportsCategory.id,
    description:
      '<h2>Basketball Game</h2><p>Join us for an exciting basketball game. Cheer for your favorite team and enjoy the game.</p><ul><li>Duration: 2 hours</li><li>Meeting Point: Murnau Sports Complex</li></ul>',
    icon: 'basketball',
    id: getId(),
    tenantId: sportsCategory.tenantId,
    title: 'Basketball Game',
    planningTips:
      '<h3>Planning Tips</h3><ul><li>Coordinate with local sports clubs for venue and equipment.</li><li>Ensure participants have appropriate sports attire.</li><li>Plan for refreshments and first aid.</li></ul>',
  },
  {
    categoryId: sportsCategory.id,
    description:
      '<h2>Volleyball Tournament</h2><p>Join us for an exciting volleyball tournament. Cheer for your favorite team and enjoy the game.</p><ul><li>Duration: 3 hours</li><li>Meeting Point: Murnau Sports Complex</li></ul>',
    icon: 'volleyball:color',
    id: getId(),
    tenantId: sportsCategory.tenantId,
    title: 'Volleyball Tournament',
  },
];
