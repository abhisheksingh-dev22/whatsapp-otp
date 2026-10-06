import { Component } from '@angular/core';
import { WhatsappOtpTestComponent } from './whatsapp-otp-test/whatsapp-otp-test.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [WhatsappOtpTestComponent],
  template: '<app-whatsapp-otp-test />',
})
export class AppComponent {}
