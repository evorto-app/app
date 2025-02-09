import { getId } from '../get-id';

export const getExampleConfigTemplates = (exampleConfigsCategory: {
  id: string;
  tenantId: string;
}) => [
  {
    categoryId: exampleConfigsCategory.id,
    description:
      '<h2>Small Event Example</h2><p>This is an example configuration for a small event. Use this template to quickly set up your own small event.</p>',
    icon: 'user-manual',
    id: getId(),
    tenantId: exampleConfigsCategory.tenantId,
    title: 'Small Event Example',
  },
  {
    categoryId: exampleConfigsCategory.id,
    description:
      '<h2>Medium Event Example</h2><p>This is an example configuration for a medium event. Use this template to quickly set up your own medium event.</p>',
    icon: 'user-manual',
    id: getId(),
    tenantId: exampleConfigsCategory.tenantId,
    title: 'Medium Event Example',
  },
  {
    categoryId: exampleConfigsCategory.id,
    description:
      '<h2>Large Event Example</h2><p>This is an example configuration for a large event. Use this template to quickly set up your own large event.</p><ul><li>Duration: 3 days</li><li>Participants: 100+</li><li>Location: Conference Center</li></ul>',
    icon: 'user-manual',
    id: getId(),
    tenantId: exampleConfigsCategory.tenantId,
    title: 'Large Event Example',
  },
];
