# Data Model

## Node Types

### Profile
Represents a resolved or partially resolved identity profile.

Properties:
- id
- confidence
- created_at
- updated_at

### Entity
Generic entity wrapper.

Properties:
- type
- value
- attributes
- updated_at

Entity types:
- username
- email
- domain
- website
- image
- location
- organization
- source

## Relationships

```cypher
(:Profile)-[:HAS_ENTITY {confidence}]->(:Entity)
(:Entity)-[:DERIVED_FROM]->(:Entity)
(:Entity)-[:APPEARS_ON]->(:Entity {type: "website"})
```

## Confidence

Suggested interpretation:

- `0.80 – 1.00`: strong correlation
- `0.50 – 0.79`: probable correlation
- `0.25 – 0.49`: weak correlation
- `< 0.25`: informational only

## Provenance

Every collector result should include:
- source name
- source URL if available
- collection timestamp
- method
- raw snippet or normalized payload
