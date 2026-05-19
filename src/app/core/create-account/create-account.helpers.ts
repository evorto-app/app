import type { UsersAuthData } from '@shared/rpc-contracts/app-rpcs/users.rpcs';

import { getErrorMessage } from '../error-message';

export interface CreateAccountModel {
  communicationEmail: string;
  firstName: string;
  lastName: string;
}

const trimmedOrUndefined = (value: null | string | undefined) =>
  value?.trim() || undefined;

export const createAccountModelFromAuthData = (
  current: CreateAccountModel,
  authData: UsersAuthData,
): CreateAccountModel => ({
  communicationEmail:
    trimmedOrUndefined(authData.email) ?? current.communicationEmail,
  firstName: trimmedOrUndefined(authData.given_name) ?? current.firstName,
  lastName: trimmedOrUndefined(authData.family_name) ?? current.lastName,
});

export const createAccountPayloadFromModel = (
  model: CreateAccountModel,
): CreateAccountModel => ({
  communicationEmail: model.communicationEmail.trim(),
  firstName: model.firstName.trim(),
  lastName: model.lastName.trim(),
});

export const createAccountErrorMessage = (error: unknown): string =>
  getErrorMessage(error, 'Failed to create account');
