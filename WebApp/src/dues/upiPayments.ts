import { Capacitor, registerPlugin } from "@capacitor/core";

type UpiPaymentRequest = {
  payeeUpiId: string;
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
  | "PENDING"
  | "CANCELLED"
  | "UNKNOWN";

const UpiPayments = registerPlugin<UpiPaymentsPlugin>("UpiPayments");

export async function openUpiPayment(request: UpiPaymentRequest) {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") {
    throw new Error("UPI payments are only available in the Android app.");
  }
  if (!/^[^@\s]+@[^@\s]+$/.test(request.payeeUpiId)) {
    throw new Error("Enter a valid UPI ID before starting a payment.");
  }

  return UpiPayments.openPayment(request);
}
