export interface access {
    base_url: string,
    login_url: string,
    email: string,
    password: string
}

export interface URLs {
    base_url: string,
    login_url: string,
}

export interface user {
    email: string,
    password: string
}

export enum durations {
    Daily="Daily",
    Monthly="Monthly",
    Yearly="Yearly"
}

export interface numericalTestData {
    duration: durations,
    principal: number,
    rate: number,
    expectedInterest: number,
    expectedAmount: number
}