import {
  type AcceptInvitationRequest,
  AuthSessionSchema,
  type ForgotPasswordRequest,
  type LoginOtpRequest,
  type LoginRequest,
  LoginResponseSchema,
  type RegisterRequest,
  type ResendCodeRequest,
  type ResetPasswordRequest,
  type VerifyEmailRequest,
} from '@govserve/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearSession, setSession } from '../auth/session-store';
import { api } from './client';

const post = (path: string, body?: unknown) =>
  api(`/api/v1/auth/${path}`, { method: 'POST', body });

export function useRegister() {
  return useMutation({ mutationFn: (body: RegisterRequest) => post('register', body) });
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (body: VerifyEmailRequest) =>
      api('/api/v1/auth/verify-email', { method: 'POST', body, schema: AuthSessionSchema }),
    onSuccess: setSession,
  });
}

export function useResendCode() {
  return useMutation({ mutationFn: (body: ResendCodeRequest) => post('resend-code', body) });
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: LoginRequest) =>
      api('/api/v1/auth/login', { method: 'POST', body, schema: LoginResponseSchema }),
    onSuccess: (res) => {
      if (res.status === 'OK') setSession(res);
    },
  });
}

export function useLoginOtp() {
  return useMutation({
    mutationFn: (body: LoginOtpRequest) =>
      api('/api/v1/auth/login/otp', { method: 'POST', body, schema: AuthSessionSchema }),
    onSuccess: setSession,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => post('logout'),
    onSettled: () => {
      clearSession();
      queryClient.clear();
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (body: ForgotPasswordRequest) => post('password/forgot', body),
  });
}

export function useResetPassword() {
  return useMutation({ mutationFn: (body: ResetPasswordRequest) => post('password/reset', body) });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (body: AcceptInvitationRequest) => post('invitations/accept', body),
  });
}
