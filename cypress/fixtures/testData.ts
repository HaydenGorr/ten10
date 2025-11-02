import { numericalTestData, durations } from "./fixture_interfaces"

export const numericalData: numericalTestData[] = [

    { duration: durations.Yearly, principal: 1000, rate: 10, expectedInterest: 100.00, expectedAmount: 1100.00 },
    { duration: durations.Monthly, principal: 1000, rate: 12, expectedInterest: 10.00, expectedAmount: 1010.00 },
    { duration: durations.Yearly, principal: 5000, rate: 15, expectedInterest: 750.00, expectedAmount: 5750.00 },
    { duration: durations.Yearly, principal: 999.99, rate: 10, expectedInterest: 100.00, expectedAmount: 1099.99 },
    
]