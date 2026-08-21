// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { TimeWheelPicker } from '../components/TimeWheelPicker';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import * as httpClient from '../data/httpClient';

describe('TimeWheelPicker & Daily Time Selection Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders closed by default with placeholder or value and Clock icon', () => {
    const onChange = vi.fn();
    render(<TimeWheelPicker value="" onChange={onChange} placeholder="เช่น 14:00" data-testid="time-picker" />);

    expect(screen.getByText('เช่น 14:00')).toBeDefined();
    expect(screen.queryByText('เลือกเวลา (24 ชม.)')).toBeNull();
  });

  it('opens 24-hour wheel picker upon clicking the trigger field', () => {
    const onChange = vi.fn();
    render(<TimeWheelPicker value="" onChange={onChange} data-testid="time-picker" />);

    const trigger = screen.getByTestId('time-picker').firstElementChild as HTMLElement;
    fireEvent.click(trigger);

    expect(screen.getByText('เลือกเวลา (24 ชม.)')).toBeDefined();
    expect(screen.getByText('ชั่วโมง (00-23)')).toBeDefined();
    expect(screen.getByText('นาที (00-59)')).toBeDefined();

    // Verify all 24 hours 00..23 exist as options
    const hourList = screen.getByRole('listbox', { name: 'ชั่วโมง' });
    expect(hourList.children.length).toBe(24);
    expect(hourList.children[0].textContent).toBe('00');
    expect(hourList.children[23].textContent).toBe('23');

    // Verify all 60 minutes 00..59 exist as options
    const minuteList = screen.getByRole('listbox', { name: 'นาที' });
    expect(minuteList.children.length).toBe(60);
    expect(minuteList.children[0].textContent).toBe('00');
    expect(minuteList.children[59].textContent).toBe('59');

    // Ensure NO AM or PM text anywhere in the component
    expect(screen.queryByText('AM')).toBeNull();
    expect(screen.queryByText('PM')).toBeNull();
    expect(screen.queryByText('am')).toBeNull();
    expect(screen.queryByText('pm')).toBeNull();
  });

  it('selects 15 for hour and 47 for minute and confirms 15:47', () => {
    const onChange = vi.fn();
    render(<TimeWheelPicker value="" onChange={onChange} data-testid="time-picker" />);

    const trigger = screen.getByTestId('time-picker').firstElementChild as HTMLElement;
    fireEvent.click(trigger);

    // Select hour 15
    const hourList = screen.getByRole('listbox', { name: 'ชั่วโมง' });
    const hour15Btn = within(hourList).getByRole('option', { name: '15' });
    fireEvent.click(hour15Btn);

    // Select minute 47
    const minuteList = screen.getByRole('listbox', { name: 'นาที' });
    const min47Btn = within(minuteList).getByRole('option', { name: '47' });
    fireEvent.click(min47Btn);

    // Click confirm "ตกลง"
    const confirmBtn = screen.getByRole('button', { name: /ตกลง/i });
    fireEvent.click(confirmBtn);

    expect(onChange).toHaveBeenCalledWith('15:47');
    expect(screen.queryByText('เลือกเวลา (24 ชม.)')).toBeNull();
  });

  it('clears selected time with clear button without opening popover', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<TimeWheelPicker value="15:47" onChange={onChange} onClear={onClear} data-testid="time-picker" />);

    expect(screen.getByText('15:47')).toBeDefined();

    const clearBtn = screen.getByRole('button', { name: 'ล้างเวลา' });
    fireEvent.click(clearBtn);

    expect(onClear).toHaveBeenCalled();
    expect(screen.queryByText('เลือกเวลา (24 ชม.)')).toBeNull();
  });

  it('clears selected time from inside the picker via "ล้างค่า"', () => {
    const onChange = vi.fn();
    render(<TimeWheelPicker value="12:00" onChange={onChange} data-testid="time-picker" />);

    const trigger = screen.getByTestId('time-picker').firstElementChild as HTMLElement;
    fireEvent.click(trigger);

    const clearActionBtn = screen.getByRole('button', { name: 'ล้างค่า' });
    fireEvent.click(clearActionBtn);

    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByText('เลือกเวลา (24 ชม.)')).toBeNull();
  });

  it('integrates TimeWheelPicker in QuickAddTenantModal DAILY tab for Check-In and Check-Out', async () => {
    const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true } as any);
    const onSuccess = vi.fn();
    const onClose = vi.fn();

    const context = {
      roomId: 'room-101',
      roomNumber: '101',
      buildingId: 'b-1',
      dormitoryId: 'dorm-1',
      effective: {
        dailyRent: 600,
        monthlyRent: 4000,
        termRent: 15000,
        depositAmount: 500,
      },
      building: {
        termMonths: 4,
        maxTermRentInstallments: 2,
      },
    };

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={onClose}
        context={context as any}
        onSuccess={onSuccess}
      />
    );

    // Switch to DAILY tab
    const dailyTabBtn = screen.getByRole('button', { name: /รายวัน/i });
    fireEvent.click(dailyTabBtn);

    // Check-In and Check-Out Time Pickers exist
    expect(screen.getByTestId('daily-checkin-time-picker')).toBeDefined();
    expect(screen.getByTestId('daily-checkout-time-picker')).toBeDefined();

    // Click Check-In time picker
    const checkInTrigger = screen.getByTestId('daily-checkin-time-picker').firstElementChild as HTMLElement;
    fireEvent.click(checkInTrigger);

    // Select hour 15 and minute 47
    const hourList = screen.getByRole('listbox', { name: 'ชั่วโมง' });
    const minuteList = screen.getByRole('listbox', { name: 'นาที' });
    fireEvent.click(within(hourList).getByRole('option', { name: '15' }));
    fireEvent.click(within(minuteList).getByRole('option', { name: '47' }));
    fireEvent.click(screen.getByRole('button', { name: /ตกลง/i }));

    // Verify Check-In now displays 15:47
    expect(screen.getByTestId('daily-checkin-time-picker').textContent).toContain('15:47');

    // Fill required tenant info
    fireEvent.change(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'สมชาย ใจดี' } });
    fireEvent.change(screen.getByPlaceholderText('เช่น 081-234-5678'), { target: { value: '0812345678' } });

    // Submit form
    const form = screen.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/i }).closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(httpSpy).toHaveBeenCalled();
    });

    const [method, url, payload] = httpSpy.mock.calls[0];
    expect(method).toBe('POST');
    expect(url).toBe('/api/v1/daily-stays/owner-quick-add');
    expect(payload.fullName).toBe('สมชาย ใจดี');
    expect(payload.checkInTime).toBe('15:47');
    // Check-Out time was left empty, so it is undefined / omitted
    expect(payload.checkOutTime).toBeUndefined();
  });
});
