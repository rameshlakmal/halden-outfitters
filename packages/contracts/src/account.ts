import { z } from 'zod';
import { Email, Id, optionalText, text, Timestamp } from './common.js';

export const ROLES = ['customer', 'support', 'warehouse', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const Password = z
  .string()
  .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters.`);

export const Me = z
  .object({
    id: Id,
    name: z.string(),
    email: z.string(),
    role: z.enum(ROLES),
    emailVerified: z.boolean(),
    createdAt: Timestamp,
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof Me>;

export const Session = z.object({ customer: Me.nullable() }).meta({ id: 'SessionState' });

export const Register = z.object({
  name: text(1, 80),
  email: Email,
  password: Password,
});

export const Login = z.object({
  email: Email,
  password: z.string().min(1, 'Required.').max(PASSWORD_MAX),
});

export const TokenBody = z.object({ token: z.string().min(20).max(100) });

export const ForgotPassword = z.object({ email: Email });

export const ResetPassword = z.object({
  token: z.string().min(20).max(100),
  password: Password,
});

export const ChangePassword = z.object({
  currentPassword: z.string().min(1, 'Required.').max(PASSWORD_MAX),
  newPassword: Password,
});

export const UpdateProfile = z.object({ name: text(1, 80) });

export const ActiveSession = z
  .object({
    id: z.string().uuid(),
    current: z.boolean(),
    userAgent: z.string().nullable(),
    ip: z.string().nullable(),
    createdAt: Timestamp,
    lastSeenAt: Timestamp,
  })
  .meta({ id: 'ActiveSession' });
export type ActiveSession = z.infer<typeof ActiveSession>;

export const MAX_ADDRESSES = 5;

export const AddressInput = z.object({
  label: optionalText(30),
  name: text(1, 80),
  line1: text(1, 120),
  line2: optionalText(120),
  city: text(1, 80),
  region: optionalText(80),
  postcode: text(2, 12),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Choose a country.'),
  phone: optionalText(20).refine((p) => p === null || /^\+?[0-9 ()-]{6,20}$/.test(p), 'Enter a phone number.'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof AddressInput>;

export const Address = z
  .object({
    id: Id,
    label: z.string().nullable(),
    name: z.string(),
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    region: z.string().nullable(),
    postcode: z.string(),
    countryCode: z.string(),
    countryName: z.string(),
    phone: z.string().nullable(),
    isDefault: z.boolean(),
  })
  .meta({ id: 'Address' });
export type Address = z.infer<typeof Address>;

export const Country = z.object({ code: z.string(), name: z.string() }).meta({ id: 'Country' });
