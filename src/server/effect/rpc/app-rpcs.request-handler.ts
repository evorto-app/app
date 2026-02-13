import { type Context as RequestContext } from '../../../types/custom/context';
import { handleAppRpcWebRequest } from './app-rpcs.web-handler';
import { RPC_CONTEXT_HEADERS } from './rpc-context-headers';

const buildRpcUser = (context: RequestContext) => {
  if (!context.user) {
    return;
  }

  return {
    attributes: context.user.attributes,
    auth0Id: context.user.auth0Id,
    email: context.user.email,
    firstName: context.user.firstName,
    iban: context.user.iban,
    id: context.user.id,
    lastName: context.user.lastName,
    paypalEmail: context.user.paypalEmail,
    permissions: context.user.permissions,
    roleIds: context.user.roleIds,
  };
};

const toRpcRequest = (
  request: Request,
  context: RequestContext,
  authData: Record<string, unknown>,
): Request => {
  const headers = new Headers(request.headers);
  const user = buildRpcUser(context);

  headers.set(
    RPC_CONTEXT_HEADERS.AUTHENTICATED,
    context.authentication.isAuthenticated ? 'true' : 'false',
  );
  headers.set(RPC_CONTEXT_HEADERS.PERMISSIONS, JSON.stringify(user?.permissions ?? []));
  headers.set(
    RPC_CONTEXT_HEADERS.USER,
    user ? JSON.stringify(user) : 'null',
  );
  headers.set(RPC_CONTEXT_HEADERS.USER_ASSIGNED, user ? 'true' : 'false');
  headers.set(RPC_CONTEXT_HEADERS.AUTH_DATA, JSON.stringify(authData));
  headers.set(RPC_CONTEXT_HEADERS.TENANT, JSON.stringify(context.tenant));

  return new Request(request, { headers });
};

export const handleAppRpcRequestWithContext = (
  request: Request,
  context: RequestContext,
  authData: Record<string, unknown>,
): Promise<Response> => handleAppRpcWebRequest(toRpcRequest(request, context, authData));
