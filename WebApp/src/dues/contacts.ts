import { Capacitor, registerPlugin } from "@capacitor/core";

export type DeviceContact = {
  id: string;
  name: string;
  phoneNumber: string;
};

type ContactsPlugin = {
  requestPermissions(): Promise<{ granted: boolean }>;
  getContacts(): Promise<{ contacts: DeviceContact[] }>;
};

const Contacts = registerPlugin<ContactsPlugin>("Contacts");

export async function readDeviceContacts(): Promise<DeviceContact[]> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("Contact access is only available in the installed mobile app.");
  }
  const permission = await Contacts.requestPermissions();
  if (!permission.granted) {
    throw new Error("Contact permission was not granted. You can enable it in your device settings.");
  }
  const result = await Contacts.getContacts();
  return result.contacts;
}
