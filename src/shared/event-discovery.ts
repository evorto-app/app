export const eventDiscoveryLabel = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string =>
  hasRegistrationOptions
    ? 'Based on sign-up choices'
    : announcementRoleCount > 0
      ? 'Shown to selected roles'
      : 'Only through its link';

export const eventDiscoveryDescription = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string => {
  if (hasRegistrationOptions) {
    return 'People see this event when at least one sign-up choice is available to them. People who are not signed in see it when a choice is open to new members. The app checks again when they sign up.';
  }
  return announcementRoleCount > 0
    ? 'Members with at least one selected role see this announcement in Events. This setting does not give anyone a role or send a message.'
    : 'This announcement does not appear in Events. People can still open its direct link.';
};
