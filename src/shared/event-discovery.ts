export const eventDiscoveryLabel = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string =>
  hasRegistrationOptions
    ? 'Sign-up event'
    : announcementRoleCount > 0
      ? 'Announcement'
      : 'Direct link only';

export const eventDiscoveryDescription = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string => {
  if (hasRegistrationOptions) {
    return 'People can find this event when a sign-up choice is available to them. People who are not signed in can see it when a choice is available to new members. Sign-in is still required before signing up.';
  }
  return announcementRoleCount > 0
    ? 'Members with a role selected on this announcement can find it in Events. This does not change what they can do or send them a message.'
    : 'This announcement does not appear in Events. People can still open it from its direct link.';
};
