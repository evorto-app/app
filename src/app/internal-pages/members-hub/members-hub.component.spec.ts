import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminHubRoleRecord } from '../../../shared/rpc-contracts/app-rpcs/admin.rpcs';

import {
  MembersHubComponent,
  MembersHubQueries,
} from './members-hub.component';

const hubRolesQuery = vi.fn<() => Promise<AdminHubRoleRecord[]>>();
const membersHubQueries = {
  hubRoles: () => ({
    queryFn: hubRolesQuery,
    queryKey: ['members-hub-roles'],
  }),
};

const normalizeText = (fixture: ComponentFixture<MembersHubComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('MembersHubComponent', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [MembersHubComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: MembersHubQueries, useValue: membersHubQueries },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('shows the loading state while hub roles are pending', async () => {
    hubRolesQuery.mockReturnValue(
      new Promise<AdminHubRoleRecord[]>((resolve) => {
        void resolve;
      }),
    );

    const fixture = TestBed.createComponent(MembersHubComponent);
    fixture.detectChanges();

    expect(normalizeText(fixture)).toContain('Members Hub');
    expect(normalizeText(fixture)).toContain("Who's who");
    expect(normalizeText(fixture)).toContain('Loading roles...');
  });

  it('renders hub roles, descriptions, member counts, and users', async () => {
    hubRolesQuery.mockResolvedValue([
      {
        description: 'Coordinates the relaunch',
        id: 'launch-team',
        name: 'Launch team',
        userCount: 2,
        users: [
          { firstName: 'Ada', id: 'ada', lastName: 'Lovelace' },
          { firstName: 'Grace', id: 'grace', lastName: 'Hopper' },
        ],
      },
      {
        description: null,
        id: 'solo-reviewer',
        name: 'Solo reviewer',
        userCount: 1,
        users: [
          { firstName: 'Margaret', id: 'margaret', lastName: 'Hamilton' },
        ],
      },
    ]);

    const fixture = TestBed.createComponent(MembersHubComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Launch team');
    });

    const text = normalizeText(fixture);
    expect(text).toContain('Coordinates the relaunch');
    expect(text).toContain('2 members');
    expect(text).toContain('Ada Lovelace, Grace Hopper');
    expect(text).toContain('Solo reviewer');
    expect(text).toContain('Margaret Hamilton');
    expect(text).not.toContain('1 members');
  });

  it('shows a readable error when hub roles fail to load', async () => {
    hubRolesQuery.mockRejectedValue(new Error('Hub roles unavailable'));

    const fixture = TestBed.createComponent(MembersHubComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Error loading roles: Hub roles unavailable',
      );
    });
  });
});
