/**
 * @license Apache-2.0
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TenantWorkspace } from '../pages/tenant';
import { TenantRegisterPage } from '../pages/tenant/TenantRegisterPage';

describe('Candidate Tenant Render Verification', () => {
  it('renders TenantWorkspace with candidate/unregistered tenant without throwing', async () => {
    const candidateTenant: any = {
      id: "candidate_ag_user_9ca7452e-14bc-422d-9eff-a53f728adf58",
      tenantNumber: "PENDING",
      firstName: "",
      lastName: "",
      displayName: "Phoom",
      name: "Phoom",
      phone: null,
      email: null,
      status: "unregistered",
      pictureUrl: "https://sprofile.line-scdn.net/abc",
      nationalIdMasked: null,
      citizenId: null,
      hasIdentityDocument: false,
      idCardPhotoMock: null,
      idCardPhotoUrl: null,
      emergencyContact: null,
      emergencyContacts: [],
      vehicles: [],
      vehicle: null,
      pet: { hasPet: false, type: "", name: "" },
      pets: [],
      coOccupants: [],
      dormitory: {
        id: "eb729e0a-4502-4df5-8e25-c60b247fc64b",
        name: "หอพัก HorPlus UAT Fresh Owner",
        petPolicy: { allowed: "none", allowedTypes: [] }
      },
      room: null,
      contract: null,
      hasRoom: false,
      pendingRequestId: null,
      pendingRequest: null
    };

    // Mock window.fetch
    window.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/tenant-portal/profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(candidateTenant)
        });
      }
      if (url.includes('/api/v1/tenant-portal/rooms')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, rooms: [] })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={candidateTenant} onLogout={() => {}} />
      </MemoryRouter>
    );

    expect(container).toBeDefined();
    // Check if hero header contains Phoom
    expect(screen.getByText(/Phoom/)).toBeDefined();
    // Check if "ยังไม่มีห้องพัก" is shown after financialLoading completes
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText(/ยังไม่มีห้องพัก/)).toBeDefined();
    });
  });

  it('renders TenantRegisterPage without crashing', async () => {
    window.fetch = vi.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} })
    }));

    const { container } = render(
      <MemoryRouter initialEntries={['/tenant/register']}>
        <TenantRegisterPage />
      </MemoryRouter>
    );

    expect(container).toBeDefined();
  });
});
