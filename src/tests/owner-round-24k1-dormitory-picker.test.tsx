/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { DormitoryPickerLogo } from '../pages/auth/OwnerLoginPage';

describe('Round 2.4K.1: Dormitory Picker Current-Logo Authority', () => {
  afterEach(() => {
    cleanup();
  });

  it('stale logoUrl + valid canonical endpoint -> canonical logo endpoint is strictly queried as image src', () => {
    const staleLogoUrl = 'https://old-s3-bucket.example.com/stale-logo.png';
    const dormitoryId = 'dorm-12345';

    const { container } = render(
      <DormitoryPickerLogo
        dormitoryId={dormitoryId}
        name="หอพักทดสอบ"
        logoUrl={staleLogoUrl}
      />
    );

    const img = container.querySelector('img')!;
    expect(img).toBeDefined();
    // Must strictly query canonical endpoint /api/v1/dormitories/:dormitoryId/logo, NOT stale logoUrl
    expect(img.getAttribute('src')).toBe(`/api/v1/dormitories/${dormitoryId}/logo`);
    expect(img.getAttribute('src')).not.toBe(staleLogoUrl);
  });

  it('canonical 404 / error -> displays Building fallback icon', () => {
    const dormitoryId = 'dorm-no-logo';

    const { container } = render(
      <DormitoryPickerLogo
        dormitoryId={dormitoryId}
        name="หอพักไม่มีโลโก้"
        logoUrl={null}
      />
    );

    const img = container.querySelector('img')!;
    // Simulate 404 load error
    fireEvent.error(img);

    // Fallback Building2 icon should be rendered and image should be unmounted
    expect(container.querySelector('[data-testid="dormitory-fallback-icon"]')).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
  });

  it('changed logo -> next render continues querying canonical endpoint with current dormitoryId', () => {
    const dormitoryId = 'dorm-updated-999';

    const { container, rerender } = render(
      <DormitoryPickerLogo
        dormitoryId={dormitoryId}
        name="หอพักอัปเดต"
      />
    );

    let img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/v1/dormitories/${dormitoryId}/logo`);

    // Simulate image loaded
    fireEvent.load(img);
    expect(img.className).toContain('opacity-100');

    // Rerender with new dormitory
    const newDormitoryId = 'dorm-new-888';
    rerender(
      <DormitoryPickerLogo
        dormitoryId={newDormitoryId}
        name="หอพักใหม่"
      />
    );

    img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/v1/dormitories/${newDormitoryId}/logo`);
  });

  it('deleted logo -> triggers fallback to Building icon', () => {
    const dormitoryId = 'dorm-deleted';

    const { container } = render(
      <DormitoryPickerLogo
        dormitoryId={dormitoryId}
        name="หอพักลบโลโก้"
      />
    );

    const img = container.querySelector('img')!;
    // Simulate 404 response on deleted logo
    fireEvent.error(img);

    expect(container.querySelector('[data-testid="dormitory-fallback-icon"]')).toBeDefined();
    expect(container.querySelector('img')).toBeNull();
  });
});
