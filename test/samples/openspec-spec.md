# Spec: User Login & Dashboard

## ADDED Requirements

### Requirement: User Login
The system SHALL allow a registered user to log in with email and password,
and return a session token via the REST API.

#### Scenario: Successful Login
- **WHEN** a registered user submits valid credentials to the login endpoint
- **THEN** the API returns HTTP 200 with a session token
- **AND** the response body contains the user id

#### Scenario: Invalid Credentials
- **WHEN** a user submits a wrong password
- **THEN** the API returns HTTP 401
- **AND** no session is created

### Requirement: Login Page Rendering
The login page SHALL render the email and password fields and a submit button.

#### Scenario: Layout
- **WHEN** the user opens the login page
- **THEN** the email input, password input and submit button are displayed
- **AND** the submit button shows the text "登录"

### Requirement: Dashboard Navigation
After login, the UI SHALL transition to the dashboard and reflect the loading state.

#### Scenario: State Transition
- **GIVEN** the user just submitted valid credentials
- **WHEN** the auth response arrives
- **THEN** the view migrates from the loading state to the dashboard state
- **AND** the spinner is removed

## MODIFIED Requirements

### Requirement: Password Reset
The reset flow now uses a 6-digit code instead of a link.

#### Scenario: Code Based Reset
- **WHEN** the user requests a reset
- **THEN** a 6-digit code is sent to the email

## REMOVED Requirements

### Requirement: Social Login
Third-party social login is no longer supported.
