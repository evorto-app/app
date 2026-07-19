interface PersistedRegistrationModeGraph {
  readonly registrationOptions: readonly PersistedRegistrationModeOption[];
  readonly simpleModeEnabled: boolean;
}

interface PersistedRegistrationModeOption extends RegistrationModeOptionIdentity {
  readonly organizingRegistration: boolean;
}

interface RegistrationModeOptionIdentity {
  readonly id: string;
}

export const persistedAdvancedToSimpleModeBlockMessage =
  'Save the compatible advanced changes first, reopen this editor, then switch to simple mode. Switching modes must preserve every persisted registration option ID.';

export const persistedAdvancedToSimpleModeIssue = (
  persistedGraph: PersistedRegistrationModeGraph | undefined,
  currentOptions: readonly RegistrationModeOptionIdentity[],
): null | string => {
  if (!persistedGraph || persistedGraph.simpleModeEnabled) return null;

  const persistedOrganizingOptionCount =
    persistedGraph.registrationOptions.filter(
      (option) => option.organizingRegistration,
    ).length;
  const persistedGraphHasSimpleShape =
    persistedGraph.registrationOptions.length === 2 &&
    persistedOrganizingOptionCount === 1;
  const currentOptionIds = new Set(currentOptions.map((option) => option.id));
  const preservesPersistedOptionIds = persistedGraph.registrationOptions.every(
    (option) => currentOptionIds.has(option.id),
  );

  return persistedGraphHasSimpleShape && preservesPersistedOptionIds
    ? null
    : persistedAdvancedToSimpleModeBlockMessage;
};
