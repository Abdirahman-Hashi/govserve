import { z } from 'zod';
import { Role } from './enums.js';

/** Password policy (FR-003). The common-password check runs server-side only. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));
export const OtpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const FullNameSchema = z.string().trim().min(2, 'Enter your full name').max(120);
/** International format, e.g. +252612345678 (spaces and dashes allowed). */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a valid phone number, e.g. +252 61 234 5678');
export const IsoDateSchema = z.iso.date('Use the format YYYY-MM-DD');

export const StaffRoles = [Role.OFFICER, Role.SUPERVISOR, Role.ADMIN] as const;
export type StaffRole = (typeof StaffRoles)[number];
export const DepartmentCodes = ['ADDRESS', 'POLICE', 'CIVIL_REGISTRY'] as const;
export type DepartmentCode = (typeof DepartmentCodes)[number];

// ─── Requests ────────────────────────────────────────────────────────────────

export const RegisterRequestSchema = z.strictObject({
  fullName: FullNameSchema,
  email: EmailSchema,
  phone: PhoneSchema,
  password: PasswordSchema,
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const VerifyEmailRequestSchema = z.strictObject({ email: EmailSchema, code: OtpCodeSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendCodeRequestSchema = z.strictObject({ email: EmailSchema });
export type ResendCodeRequest = z.infer<typeof ResendCodeRequestSchema>;

export const LoginRequestSchema = z.strictObject({
  email: EmailSchema,
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginOtpRequestSchema = z.strictObject({ challengeId: z.uuid(), code: OtpCodeSchema });
export type LoginOtpRequest = z.infer<typeof LoginOtpRequestSchema>;

export const ForgotPasswordRequestSchema = z.strictObject({ email: EmailSchema });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.strictObject({
  email: EmailSchema,
  code: OtpCodeSchema,
  password: PasswordSchema,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const AcceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(32).max(128),
  password: PasswordSchema,
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const UpdateProfileRequestSchema = z.strictObject({
  fullName: FullNameSchema.optional(),
  phone: PhoneSchema.optional(),
  // Citizens only (FR-010); staff sending these get 403.
  nationalIdType: z.enum(['NATIONAL_ID', 'PASSPORT']).optional(),
  nationalId: z.string().trim().min(4).max(32).optional(),
  dateOfBirth: IsoDateSchema.optional(),
});
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangeEmailRequestSchema = z.strictObject({ newEmail: EmailSchema });
export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

export const ConfirmEmailChangeRequestSchema = z.strictObject({ code: OtpCodeSchema });
export type ConfirmEmailChangeRequest = z.infer<typeof ConfirmEmailChangeRequestSchema>;

const departmentRule = (v: { role?: StaffRole; departmentCode?: DepartmentCode | null }) =>
  v.role === undefined || (v.role === 'ADMIN' ? !v.departmentCode : Boolean(v.departmentCode));
const departmentRuleMessage = {
  message: 'Officers and supervisors need a department; admins have none',
  path: ['departmentCode'],
};

export const InviteStaffRequestSchema = z
  .strictObject({
    email: EmailSchema,
    fullName: FullNameSchema,
    role: z.enum(StaffRoles),
    departmentCode: z.enum(DepartmentCodes).nullish(),
  })
  .refine(departmentRule, departmentRuleMessage);
export type InviteStaffRequest = z.infer<typeof InviteStaffRequestSchema>;

export const UpdateStaffRequestSchema = z
  .strictObject({ role: z.enum(StaffRoles), departmentCode: z.enum(DepartmentCodes).nullish() })
  .refine(departmentRule, departmentRuleMessage);
export type UpdateStaffRequest = z.infer<typeof UpdateStaffRequestSchema>;

// ─── Responses ───────────────────────────────────────────────────────────────

export const SessionUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(Role),
  departmentCode: z.enum(DepartmentCodes).nullable(),
  emailVerified: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const AuthSessionSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: SessionUserSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const LoginResponseSchema = z.discriminatedUnion('status', [
  AuthSessionSchema.extend({ status: z.literal('OK') }),
  z.object({ status: z.literal('OTP_REQUIRED'), challengeId: z.uuid() }),
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const ProfileSchema = SessionUserSchema.extend({
  phone: z.string().nullable(),
  nationalIdType: z.enum(['NATIONAL_ID', 'PASSPORT']).nullable(),
  /** Masked except the last 3 characters; the full value is never returned. */
  nationalIdMasked: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const StaffMemberSchema = SessionUserSchema.extend({
  status: z.enum(['ACTIVE', 'LOCKED', 'DEACTIVATED']),
  lastLoginAt: z.iso.datetime().nullable(),
});
export type StaffMember = z.infer<typeof StaffMemberSchema>;

export const StaffInvitationResponseSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(StaffRoles),
  expiresAt: z.iso.datetime(),
});
export type StaffInvitationResponse = z.infer<typeof StaffInvitationResponseSchema>;

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  CITIZEN: '/citizen',
  OFFICER: '/officer',
  SUPERVISOR: '/officer',
  ADMIN: '/admin',
};
