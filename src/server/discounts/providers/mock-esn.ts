import { effect, Schema } from 'effect';

// Mock ESNcard provider that doesn't rely on external API
// This allows testing without network dependencies
export const mockEsnCardProvider = {
  async validate({ identifier }: { config?: any; identifier: string }) {
    // Simple validation logic for testing
    if (!identifier) {
      return { status: 'invalid' };
    }

    // Test card identifiers that should be valid
    const validTestCards = ['TEST123456', 'ESN001', 'ESN002', 'DEMO001'];

    if (validTestCards.includes(identifier)) {
      return {
        metadata: {
          cardNumber: identifier,
          country: 'TestLand',
          holderName: `Test User ${identifier}`,
          university: 'Test University',
        },
        status: 'verified' as const,
        validFrom: new Date('2024-01-01'),
        validTo: new Date('2025-12-31'),
      };
    }

    // Expired test card
    if (identifier === 'EXPIRED001') {
      return {
        metadata: {
          cardNumber: identifier,
          holderName: 'Expired User',
        },
        status: 'expired' as const,
        validFrom: new Date('2023-01-01'),
        validTo: new Date('2023-12-31'),
      };
    }

    // Invalid test card
    if (identifier.startsWith('INVALID')) {
      return { status: 'invalid' as const };
    }

    // Default to unverified for unknown cards
    return { status: 'unverified' as const };
  },
};
