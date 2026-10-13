package com.blackdotorigin.financeflow;

import android.Manifest;
import android.database.Cursor;
import android.provider.ContactsContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "Contacts",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS })
    }
)
public class ContactsPlugin extends Plugin {

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            resolvePermission(call);
            return;
        }
        requestPermissionForAlias("contacts", call, "contactsPermissionCallback");
    }

    @PermissionCallback
    private void contactsPermissionCallback(PluginCall call) {
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", getPermissionState("contacts") == PermissionState.GRANTED);
        call.resolve(result);
    }

    @PluginMethod
    public void getContacts(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            call.reject("Contact access has not been granted.");
            return;
        }

        JSArray contacts = new JSArray();
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (
            Cursor cursor = getContext().getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                null,
                null,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME + " ASC"
            )
        ) {
            if (cursor != null) {
                int idColumn = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID);
                int nameColumn = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numberColumn = cursor.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (cursor.moveToNext()) {
                    String id = cursor.getString(idColumn);
                    String name = cursor.getString(nameColumn);
                    String phoneNumber = cursor.getString(numberColumn);
                    if (name == null || name.trim().isEmpty() || phoneNumber == null || phoneNumber.trim().isEmpty()) {
                        continue;
                    }
                    JSObject contact = new JSObject();
                    contact.put("id", id == null ? phoneNumber : id);
                    contact.put("name", name.trim());
                    contact.put("phoneNumber", phoneNumber.trim());
                    contacts.put(contact);
                }
            }
        } catch (Exception exception) {
            call.reject("Could not read contacts from this device.", exception);
            return;
        }

        JSObject result = new JSObject();
        result.put("contacts", contacts);
        call.resolve(result);
    }
}
