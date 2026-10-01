-- AlterTable
ALTER TABLE "User" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "isGuest" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "User_isGuest_expiresAt_idx" ON "User"("isGuest", "expiresAt");
