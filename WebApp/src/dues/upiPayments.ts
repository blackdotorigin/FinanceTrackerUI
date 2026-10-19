import { Capacitor, registerPlugin } from "@capacitor/core";

type UpiPaymentRequest = {
  payeeUpiId?: string;
  payeePhoneNumber?: string;
  payeeName: string;
  amount: string;
  note: string;
};

type UpiPaymentsPlugin = {
  openPayment(request: UpiPaymentRequest): Promise<{ status: UpiPaymentStatus }>;
};

export type UpiPaymentStatus =
  | "SUCCESS"
  | "FAILURE"
  | "RECIPIENT_NOT_FOUND"
  | "PENDING"
  | "CANCELLED"
  | "UNKNOWN";

const UpiPayments = registerPlugin<UpiPaymentsPlugin>("UpiPayments");

export async function openUpiPayment(request: UpiPaymentRequest) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("UPI payments are only available in the Android app.");
  }
  const payeeUpiId = request.payeeUpiId?.trim() ?? "";
  const payeePhoneNumber = request.payeePhoneNumber?.trim().replace(/[^\d+]/g, "") ?? "";
  const validPhoneNumber = /^\+?\d{8,15}$/.test(payeePhoneNumber);
  if (!/^[^@\s]+@[^@\s]+$/.test(payeeUpiId) && !validPhoneNumber) {
    throw new Error("Enter a valid UPI ID or mobile number before starting a payment.");
  }

  return UpiPayments.openPayment({
    ...request,
    payeeUpiId: payeeUpiId || undefined,
    payeePhoneNumber: validPhoneNumber ? payeePhoneNumber : undefined,
  });
}
