import { permissionForRequest } from './router';
import {
  taskCreatePermission,
  taskDeletePermission,
  traineesManagePermission,
  taskReadAllPermission,
  taskReadPermission,
  traineesReadPermission,
  capstonesEnrollPermission,
  capstonesManagePermission,
} from '../permissions';

describe('permissionForRequest', () => {
  it('maps the Trainees view (list, detail and the GitHub activity read) to its own permission, trailing slash and letter case included', () => {
    expect(permissionForRequest('GET', '/tasks/admin/trainees/list')).toBe(traineesReadPermission);
    expect(permissionForRequest('GET', '/tasks/admin/trainees/list/')).toBe(traineesReadPermission);
    expect(permissionForRequest('GET', '/Tasks/Admin/Trainees/List')).toBe(traineesReadPermission);
    expect(permissionForRequest('GET', '/tasks/admin/trainees/detail')).toBe(traineesReadPermission);
    expect(permissionForRequest('GET', '/tasks/admin/trainees/detail/')).toBe(traineesReadPermission);
    // Reading activity is a POST only because it carries up to 50 keys.
    expect(permissionForRequest('POST', '/tasks/admin/trainees/activity')).toBe(traineesReadPermission);
    expect(permissionForRequest('POST', '/tasks/admin/trainees/activity/')).toBe(traineesReadPermission);
    expect(permissionForRequest('POST', '/TASKS/ADMIN/TRAINEES/ACTIVITY')).toBe(traineesReadPermission);
  });

  it('the old list path and every other read or write under /tasks/admin/trainees stays admin-only', () => {
    expect(permissionForRequest('GET', '/tasks/admin/trainees')).toBe(taskReadAllPermission);
    expect(permissionForRequest('GET', '/tasks/admin/trainees/other')).toBe(taskReadAllPermission);
    expect(permissionForRequest('GET', '/tasks/admin/trainees/activity')).toBe(taskReadAllPermission);
    expect(permissionForRequest('POST', '/tasks/admin/trainees/list')).toBe(taskReadAllPermission);
    expect(permissionForRequest('POST', '/tasks/admin/trainees/detail')).toBe(taskReadAllPermission);
    expect(permissionForRequest('DELETE', '/tasks/admin/trainees/activity')).toBe(taskReadAllPermission);
  });

  it('defaults every other /tasks/admin path to the strict read-all permission', () => {
    expect(permissionForRequest('GET', '/tasks/admin/all')).toBe(taskReadAllPermission);
    expect(permissionForRequest('GET', '/tasks/admin/all/')).toBe(taskReadAllPermission);
    expect(permissionForRequest('GET', '/tasks/admin/anything-new')).toBe(taskReadAllPermission);
  });

  it('gates Remove trainee on its own permission, and never lets an admin write fall to task.create', () => {
    expect(permissionForRequest('POST', '/tasks/admin/trainees/remove')).toBe(traineesManagePermission);
    expect(permissionForRequest('POST', '/tasks/admin/trainees/remove/')).toBe(traineesManagePermission);
    expect(permissionForRequest('POST', '/tasks/admin/trainees')).toBe(taskReadAllPermission);
    expect(permissionForRequest('DELETE', '/tasks/admin/trainees/remove')).toBe(taskReadAllPermission);
    expect(permissionForRequest('PUT', '/tasks/admin/anything')).toBe(taskReadAllPermission);
  });

  it('keeps the user-scoped task routes on their existing permissions', () => {
    expect(permissionForRequest('GET', '/tasks')).toBe(taskReadPermission);
    expect(permissionForRequest('GET', '/tasks/123e4567-e89b-12d3-a456-426614174000')).toBe(taskReadPermission);
    // Retry's port check reads the caller's own task: an ordinary read, nothing more.
    expect(permissionForRequest('GET', '/tasks/123e4567-e89b-12d3-a456-426614174000/retry-conflicts')).toBe(taskReadPermission);
    expect(permissionForRequest('POST', '/tasks')).toBe(taskCreatePermission);
    expect(permissionForRequest('DELETE', '/tasks/x')).toBe(taskDeletePermission);
    expect(permissionForRequest('GET', '/agent/poll')).toBeUndefined();
  });
});

describe('permissionForRequest — capstones', () => {
  it('lets signed-in users enroll themselves and link their own repo', () => {
    expect(permissionForRequest('POST', '/capstones/enrollments')).toBe(capstonesEnrollPermission);
    expect(permissionForRequest('POST', '/capstones/enrollments/')).toBe(capstonesEnrollPermission);
    expect(permissionForRequest('PUT', '/capstones/enrollments/abc/repo')).toBe(capstonesEnrollPermission);
  });

  it('defaults everything else under /capstones to manage', () => {
    for (const [m, p] of [
      ['GET', '/capstones/enrollments'],
      ['GET', '/capstones/enrollments/abc/secrets'],
      ['POST', '/capstones/enrollments/abc/handout'],
      ['GET', '/capstones'],
      ['DELETE', '/capstones/enrollments/abc'],
      ['PUT', '/capstones/enrollments/abc/repo/extra'],
    ]) {
      expect(permissionForRequest(m, p)).toBe(capstonesManagePermission);
    }
  });
});
