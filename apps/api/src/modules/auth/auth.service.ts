import type { Logger } from 'pino';
import type { User } from '@osd/db';
import type { UserDto } from '@osd/shared';
import { generateLoginCode, hashLoginCode, loginCodeMatches } from '../../lib/codes.js';
import { notFound, rateLimited, unauthorized } from '../../lib/errors.js';
import type { FixedWindowLimiter } from '../../lib/limiter.js';
import type { AuthRepository } from './auth.repository.js';
import type { EmailSender } from './email.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

const INVALID_CODE = 'Invalid or expired code';

export class AuthService {
  constructor(
    private readonly repo: AuthRepository,
    private readonly email: EmailSender,
    private readonly emailLimiter: FixedWindowLimiter,
    private readonly secret: string,
    private readonly logger: Logger,
    private readonly guest: { enabled: boolean; ttlSeconds: number },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Sends a 6-digit code. Responds the same whether or not the account exists. */
  async requestCode(email: string): Promise<void> {
    if (!(await this.emailLimiter.hit(email)))
      throw rateLimited('Too many codes requested for this email');
    const code = generateLoginCode();
    const expiresAt = new Date(this.now().getTime() + CODE_TTL_MS);
    await this.repo.createCode(email, hashLoginCode(this.secret, email, code), expiresAt);
    await this.email.sendLoginCode(email, code);
    this.logger.info({ email }, 'login code issued');
  }

  /** Verifies a code (max 5 attempts per code) and returns the user, creating it on first login. */
  async verify(email: string, code: string): Promise<User> {
    const record = await this.repo.findActiveCode(email, this.now());
    if (!record) throw unauthorized(INVALID_CODE);
    if (!(await this.repo.registerAttempt(record.id, MAX_CODE_ATTEMPTS))) {
      throw unauthorized('Too many attempts, request a new code');
    }
    if (!loginCodeMatches(this.secret, email, code, record.codeHash))
      throw unauthorized(INVALID_CODE);
    if (!(await this.repo.consume(record.id))) throw unauthorized(INVALID_CODE);
    const user = await this.repo.upsertUser(email);
    if (user.isGuest) throw unauthorized(INVALID_CODE);
    return user;
  }

  /** Creates a fresh throwaway account; it and everything it owns are deleted after the TTL. */
  async loginAsGuest(): Promise<User> {
    if (!this.guest.enabled) throw notFound('Guest login');
    const expiresAt = new Date(this.now().getTime() + this.guest.ttlSeconds * 1000);
    const user = await this.repo.createGuest(expiresAt);
    this.logger.info({ userId: user.id, expiresAt }, 'guest account created');
    return user;
  }

  /** Session lifetime for a user: guests never outlive their account. */
  sessionTtlSeconds(user: User, defaultTtl: number): number {
    if (!user.expiresAt) return defaultTtl;
    const left = Math.floor((user.expiresAt.getTime() - this.now().getTime()) / 1000);
    return Math.max(1, Math.min(defaultTtl, left));
  }

  async me(userId: string): Promise<User> {
    const user = await this.repo.findUser(userId);
    if (!user || isExpired(user, this.now())) throw unauthorized();
    return user;
  }
}

export function isExpired(user: User, now: Date): boolean {
  return user.expiresAt !== null && user.expiresAt <= now;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    isGuest: user.isGuest,
    expiresAt: user.expiresAt?.toISOString() ?? null,
  };
}
