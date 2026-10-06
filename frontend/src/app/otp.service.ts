import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class OtpService {
  private http = inject(HttpClient);

  sendOtp(mobile: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>('/api/otp/send', { mobile });
  }

  verifyOtp(mobile: string, otp: string): Observable<{ verified: boolean }> {
    return this.http.post<{ verified: boolean }>('/api/otp/verify', { mobile, otp });
  }
}
