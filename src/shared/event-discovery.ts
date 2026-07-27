export const eventDiscoveryLabel = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string =>
  hasRegistrationOptions
    ? 'Eligibility based'
    : announcementRoleCount > 0
      ? 'Announcement'
      : 'Link only';

export const eventDiscoveryDescription = ({
  announcementRoleCount,
  hasRegistrationOptions,
}: {
  announcementRoleCount: number;
  hasRegistrationOptions: boolean;
}): string => {
  if (hasRegistrationOptions) {
    return 'Discovery follows current registration-option role eligibility. Anonymous discovery uses roles assigned by default to new members. Eligibility is checked again when someone registers.';
  }
  return announcementRoleCount > 0
    ? 'Shown in event discovery to people with at least one selected role. This does not grant access or send notifications.'
    : 'Hidden from event discovery; use a direct link.';
};
