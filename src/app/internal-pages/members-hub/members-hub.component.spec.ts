import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminHubRoleRecord } from '../../../shared/rpc-contracts/app-rpcs/admin.rpcs';

import { PermissionsService } from '../../core/permissions.service';
import {
  MembersHubComponent,
  MembersHubQueries,
} from './members-hub.component';

const hubRolesQuery = vi.fn<() => Promise<AdminHubRoleRecord[]>>();
const membersHubQueries = {
  hubResources: () => ({
    queryFn: async () => [],
    queryKey: ['hub-resources'],
  }),
  hubRoles: () => ({
    queryFn: hubRolesQuery,
    queryKey: ['members-hub-roles'],
  }),
  saveResources: () => ({
    mutationFn: async () => {
      throw new Error('Unexpected resource save');
    },
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
        {
          provide: PermissionsService,
          useValue: { hasPermission: () => signal(false) },
        },
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
    expect(normalizeText(fixture)).toContain('Loading members…');
  });

  it('renders named role sections with descriptions and individual member lists', async () => {
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
    expect(text).toContain('Ada Lovelace Grace Hopper');
    expect(text).toContain('Solo reviewer');
    expect(text).toContain('Margaret Hamilton');
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(3);
  });

  it('shows a readable error without exposing raw failures', async () => {
    hubRolesQuery.mockRejectedValue(new Error('Hub roles unavailable'));

    const fixture = TestBed.createComponent(MembersHubComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'We could not load the member list. Try again.',
      );
      expect(normalizeText(fixture)).not.toContain('Hub roles unavailable');
    });
  });
});
