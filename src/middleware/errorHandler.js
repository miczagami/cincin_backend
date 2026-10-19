const config = require("../config");

/**
 * Central error handler. Catches all thrown/next(err) errors.
 */
function errorHandler(err, req, res, _next) {
  // Expected client errors (bad input, auth failures) get one line; everything else the full error
  if (err.statusCode && err.statusCode < 500) {
    console.warn(`[WARN] ${req.method} ${req.path}: ${err.statusCode} ${err.message}`);
  } else {
    console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  }

  // Prisma known errors
  if (err.code === "P2002") {
    return res.status(409).json({
      error: "Duplicate entry",
      field: err.meta?.target?.[0],
    });
  }
  if (err.code === "P2025") {
    return res.status(404).json({ error: "Record not found" });
  }

  // Validation errors (from express-validator)
  if (err.type === "validation") {
    return res.status(400).json({
      error: "Validation failed",
      details: err.errors,
    });
  }

  // Application errors with status codes
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  // Default 500
  res.status(500).json({
    error: config.env === "production"
      ? "Internal server error"
      : err.message,
  });
}

/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Not found",
    path: req.originalUrl,
  });
}

module.exports = { errorHandler, notFoundHandler };
