/**
 * Change Password (Authenticated) — Priority 1 addition to authService.js
 *
 * This function should be added to the existing authService.js module
 * and exported alongside the existing functions.
 *
 * Endpoint: POST /api/auth/change-password (requires requireAuth middleware)
 *
 * Validates current password, enforces password policy (8+ chars, letter + number),
 * updates the hash, and invalidates all other sessions (keeping the current one).
 */

// ─── Add this function to authService.js ───

async function changePassword(userId, { currentPassword, newPassword }, currentToken) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, authProvider: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404);
  }

  // Social-only accounts can't change password
  if (!user.passwordHash || user.authProvider !== "EMAIL") {
    throw new AppError(
      "This account uses social login. Password change is not available.",
      400
    );
  }

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError("Current password is incorrect", 401);
  }

  // Enforce password policy
  if (!newPassword || newPassword.length < 8) {
    throw new AppError("New password must be at least 8 characters", 400);
  }
  if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    throw new AppError("New password must contain both letters and numbers", 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    // Invalidate all sessions EXCEPT the current one
    prisma.session.deleteMany({
      where: {
        userId,
        token: { not: currentToken },
      },
    }),
  ]);

  return { message: "Password changed successfully." };
}

// ─── Add to module.exports ───
// changePassword,
