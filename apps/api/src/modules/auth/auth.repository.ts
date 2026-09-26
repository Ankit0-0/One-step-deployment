import type { AuthCode, PrismaClient, User } from '@osd/db';

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Replaces any outstanding codes for the email with a new one. */
  async createCode(email: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.authCode.updateMany({
        where: { email, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authCode.create({ data: { email, codeHash, expiresAt } }),
    ]);
  }

  findActiveCode(email: string, now: Date): Promise<AuthCode | null> {
    return this.prisma.authCode.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Atomically counts an attempt; false when the code is out of attempts. */
  async registerAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const { count } = await this.prisma.authCode.updateMany({
      where: { id, consumedAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  /** Marks the code used; false if another request consumed it first. */
  async consume(id: string): Promise<boolean> {
    const { count } = await this.prisma.authCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }

  upsertUser(email: string): Promise<User> {
    return this.prisma.user.upsert({ where: { email }, update: {}, create: { email } });
  }

  findUser(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
