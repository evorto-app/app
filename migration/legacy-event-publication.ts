export const legacyEventReviewStatus = (
  publicationState: 'APPROVAL' | 'DRAFT' | 'ORGANIZERS' | 'PUBLIC',
): 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' => {
  switch (publicationState) {
    case 'APPROVAL':
      return 'PENDING_REVIEW';
    case 'DRAFT':
      return 'DRAFT';
    case 'PUBLIC':
      return 'APPROVED';
    case 'ORGANIZERS':
      throw new Error(
        'Legacy organizer-only publication has no target representation; migration is blocked.',
      );
  }
};
