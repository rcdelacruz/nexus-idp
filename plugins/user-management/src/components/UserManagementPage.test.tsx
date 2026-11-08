import React from 'react';
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { identityApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '@internal/plugin-local-provisioner';
import { UserManagementPage } from './UserManagementPage';
import { userManagementApiRef } from '../api/refs';
import { UserRow } from './userRecords';

// The first render of the Backstage table in jsdom takes ~1.5 s and more on a loaded machine.
jest.setTimeout(30000);
configure({ asyncUtilTimeout: 8000 });

const ADMIN_REFS = ['user:default/jane.doe', 'group:default/backstage-admins'];

const rows = (): UserRow[] => [
  { name: 'jane.doe', display_name: 'Ronald Dela Cruz', email: 'jane.doe@example.com', teams: [], is_lead: false, is_admin: true, is_instructor: false, github_username: 'ron' },
  { name: 'ann.cruz', display_name: 'Ann Cruz', email: 'ann.cruz@example.com', teams: ['web-team'], is_lead: false, is_admin: false, is_instructor: false, github_username: 'ann' },
  { name: 'ivan.coach', display_name: 'Ivan Coach', email: 'ivan.coach@example.com', teams: ['cloud-team'], is_lead: true, is_admin: false, is_instructor: true, github_username: 'ivan' },
  { name: 'tess.trainee', display_name: 'Tess Trainee', email: 'tess.trainee@example.com', teams: ['general-engineers'], is_lead: false, is_admin: false, is_instructor: false, github_username: null },
  { name: 'ghost', display_name: 'Gus Ghost', email: 'ghost@example.com', teams: [], is_lead: false, is_admin: false, is_instructor: false, github_username: 'gus' },
];

const renderPage = async (opts: { refs?: string[]; users?: UserRow[]; setInstructor?: jest.Mock; assign?: jest.Mock } = {}) => {
  const api = {
    listUsers: jest.fn(async () => opts.users ?? rows()),
    setInstructor: opts.setInstructor ?? jest.fn(async () => ({ ok: true })),
    assign: opts.assign ?? jest.fn(async () => ({ ok: true, message: 'assigned' })),
    promote: jest.fn(),
    deleteUser: jest.fn(),
  };
  const identity = {
    getBackstageIdentity: async () => ({ userEntityRef: 'user:default/jane.doe', ownershipEntityRefs: opts.refs ?? ADMIN_REFS }),
  };
  await renderInTestApp(
    <TestApiProvider apis={[[userManagementApiRef, api as any], [identityApiRef, identity as any], [localProvisionerApiRef, { getAllTasksAdmin: jest.fn(async () => []) } as any]]}>
      <UserManagementPage />
    </TestApiProvider>,
  );
  return { api };
};

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

describe('User Management — instructor role', () => {
  it('shows who is an instructor, as a badge and as the instructors group', async () => {
    await renderPage();
    await screen.findByText('Ivan Coach');
    expect(within(rowOf('Ivan Coach')).getByText('Instructor')).toBeInTheDocument();
    expect(within(rowOf('Ivan Coach')).getByText('instructors')).toBeInTheDocument();
    expect(within(rowOf('Ivan Coach')).getByText('Cloud')).toBeInTheDocument(); // team still shown
    expect(within(rowOf('Ann Cruz')).queryByText('Instructor')).not.toBeInTheDocument();
    expect(within(rowOf('Ann Cruz')).queryByText('instructors')).not.toBeInTheDocument();
  });

  it('keeps hiding people who have not finished onboarding', async () => {
    await renderPage();
    await screen.findByText('Ivan Coach');
    expect(screen.queryByText('Gus Ghost')).not.toBeInTheDocument();
  });

  it('lists an instructor who has no department team, as the only thing marking them', async () => {
    await renderPage({ users: [{ ...rows()[3], teams: [], is_instructor: true }] });
    await screen.findByText('Tess Trainee');
    expect(within(rowOf('Tess Trainee')).getByText('Instructor')).toBeInTheDocument();
  });

  it('grants the role after a confirmation, tells the admin what it allows, and updates the row', async () => {
    const { api } = await renderPage();
    await screen.findByText('Ann Cruz');
    fireEvent.click(screen.getByRole('button', { name: 'Make Ann Cruz an instructor' }));

    expect(await screen.findByText('Make instructor — Ann Cruz')).toBeInTheDocument();
    expect(screen.getByText(/Trainees page.*answer keys and credentials.*remove trainees together with their lab repository/)).toBeInTheDocument();
    expect(screen.getByText(/session next refreshes or they sign in again/)).toBeInTheDocument();
    expect(api.setInstructor).not.toHaveBeenCalled(); // nothing happens before the confirm

    fireEvent.click(screen.getByRole('button', { name: 'Make instructor' }));
    await waitFor(() => expect(api.setInstructor).toHaveBeenCalledWith({ userName: 'ann.cruz', isInstructor: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(within(rowOf('Ann Cruz')).getByText('Instructor')).toBeInTheDocument());
    expect(within(rowOf('Ann Cruz')).getByText('instructors')).toBeInTheDocument();
    // the action flips to Revoke
    expect(screen.getByRole('button', { name: 'Revoke instructor from Ann Cruz' })).toBeInTheDocument();
  });

  it('revokes the role and removes the badge and the group', async () => {
    const { api } = await renderPage();
    await screen.findByText('Ivan Coach');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke instructor from Ivan Coach' }));
    expect(await screen.findByText('Revoke instructor — Ivan Coach')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke instructor' }));
    await waitFor(() => expect(api.setInstructor).toHaveBeenCalledWith({ userName: 'ivan.coach', isInstructor: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(within(rowOf('Ivan Coach')).queryByText('Instructor')).not.toBeInTheDocument());
    expect(within(rowOf('Ivan Coach')).queryByText('instructors')).not.toBeInTheDocument();
    expect(within(rowOf('Ivan Coach')).getByText('cloud-lead')).toBeInTheDocument(); // other groups untouched
  });

  it('shows the backend refusal and leaves the row alone', async () => {
    const setInstructor = jest.fn(async () => { throw new Error('Only platform admins can grant or revoke the instructor role'); });
    await renderPage({ setInstructor });
    await screen.findByText('Ann Cruz');
    fireEvent.click(screen.getByRole('button', { name: 'Make Ann Cruz an instructor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make instructor' }));
    expect(await screen.findByText(/Only platform admins can grant or revoke/)).toBeInTheDocument();
    expect(within(rowOf('Ann Cruz')).queryByText('Instructor')).not.toBeInTheDocument();
  });

  it('keeps the instructors group when an admin reassigns the instructor to other teams', async () => {
    const { api } = await renderPage();
    await screen.findByText('Ivan Coach');
    fireEvent.click(screen.getByRole('button', { name: 'Reassign Ivan Coach to a team' }));
    fireEvent.click(await screen.findByLabelText('Web'));
    fireEvent.click(screen.getByRole('button', { name: /Assign to/ }));
    await waitFor(() => expect(api.assign).toHaveBeenCalled());
    expect(api.assign.mock.calls[0][0]).toMatchObject({ userName: 'ivan.coach', teams: ['cloud-team', 'web-team'] });
    expect(api.assign.mock.calls[0][0]).not.toHaveProperty('isInstructor');
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(within(rowOf('Ivan Coach')).getByText('web-team')).toBeInTheDocument());
    expect(within(rowOf('Ivan Coach')).getByText('instructors')).toBeInTheDocument();
    expect(within(rowOf('Ivan Coach')).getByText('Instructor')).toBeInTheDocument();
  });

  it('is closed to anyone who is not a platform admin and never loads the users', async () => {
    const { api } = await renderPage({ refs: ['user:default/ann.cruz', 'group:default/instructors'] });
    expect(await screen.findByText('Admin access required')).toBeInTheDocument();
    expect(api.listUsers).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /instructor/i })).not.toBeInTheDocument();
  });
});
