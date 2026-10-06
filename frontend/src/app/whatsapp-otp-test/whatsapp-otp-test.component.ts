import { Component, OnDestroy, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { OtpService } from '../otp.service';

const RESEND_SECONDS = 30;

@Component({
  selector: 'app-whatsapp-otp-test',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './whatsapp-otp-test.component.html',
  styleUrl: './whatsapp-otp-test.component.css',
})
export class WhatsappOtpTestComponent implements OnDestroy {
  private fb = inject(FormBuilder);
  private otpService = inject(OtpService);

  step = signal<1 | 2>(1);
  loading = signal(false);
  timer = signal(0);
  error = signal('');
  verified = signal(false);

  private intervalId?: ReturnType<typeof setInterval>;

  form = this.fb.nonNullable.group({
    mobile: ['', [Validators.required, Validators.pattern(/^[6-9]\d{9}$/)]],
    otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  send() {
    const mobile = this.form.controls.mobile;
    if (mobile.invalid || this.loading()) {
      mobile.markAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.otpService.sendOtp(mobile.value).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set(2);
        mobile.disable();
        this.form.controls.otp.reset('');
        this.startTimer();
      },
      error: (e) => this.fail(e),
    });
  }

  verify() {
    const { mobile, otp } = this.form.controls;
    if (otp.invalid || this.loading()) {
      otp.markAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.otpService.verifyOtp(mobile.value, otp.value).subscribe({
      next: (r) => {
        this.loading.set(false);
        this.stopTimer();
        this.verified.set(r.verified);
      },
      error: (e) => this.fail(e),
    });
  }

  changeNumber() {
    this.stopTimer();
    this.timer.set(0);
    this.error.set('');
    this.form.controls.otp.reset('');
    this.form.controls.mobile.enable();
    this.step.set(1);
  }

  reset() {
    this.changeNumber();
    this.form.reset();
    this.verified.set(false);
  }

  private fail(e: HttpErrorResponse) {
    this.loading.set(false);
    this.error.set(e.error?.message ?? 'Something went wrong. Please try again.');
  }

  private startTimer() {
    this.stopTimer();
    this.timer.set(RESEND_SECONDS);
    this.intervalId = setInterval(() => {
      this.timer.update((t) => t - 1);
      if (this.timer() <= 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer() {
    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  ngOnDestroy() {
    this.stopTimer();
  }
}
