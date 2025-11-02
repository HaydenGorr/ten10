import { durations } from "../fixtures/fixture_interfaces"



export class InterestCalculator {
    dropdownButton = "button[data-toggle=\"dropdown\"]"
    principalSliderInput = "input.custom-range"
    selectedPrincipleValue = "#selectedValue"
    durationDailyButton = "#durationList > [data-value=\"Daily\"]"
    durationMonthlyButton = "#durationList > [data-value=\"Monthly\"]"
    durationYearlyButton = "#durationList > [data-value=\"Yearly\"]"
    mandatoryConsentCheckbox = ".form-check > input"
    calculateButton = "button[onclick=\"calculateInterest()\"]" // Bad selector - will fix

    interestDropdownMenu = new InterestDropdownMenu();
    calculationResults = new calculationResults();

    /**
     * GETTERS
     */
    getDropdownButton(){
        return cy.get(this.dropdownButton)
    }

    getPrincipalSliderInput() {
        return cy.get(this.principalSliderInput)
    }

    getSelectedPrincipleValue() {
        return cy.get(this.selectedPrincipleValue)
    }

    getDurationDailyButton() {
        return cy.get(this.durationDailyButton)
    }

    getDurationMonthlyButton() {
        return cy.get(this.durationMonthlyButton)
    }

    getDurationYearlyButton() {
        return cy.get(this.durationYearlyButton)
    }

    getMandatoryConsentCheckbox(){
        return cy.get(this.mandatoryConsentCheckbox)
    }

    getCalculateButton(){
        return cy.get(this.calculateButton)
    }

    /**
     * FUNCTIONS
     */
    toggleDropdownMenu() {
        return this.getDropdownButton().click()
    }

    inputValueInPrincipalSlider(value: number) {
        return this.getPrincipalSliderInput().invoke('val', value).trigger('input').trigger('change')
    }

    clickDuration(chosenDuration: durations){
        switch(chosenDuration){
            case durations.Daily:
                this.getDurationDailyButton().click();
                break;
            case durations.Monthly:
                this.getDurationMonthlyButton().click();
                break;
            case durations.Yearly:
                this.getDurationYearlyButton().click();
                break;
        }
    }
    
}

/**
 * Where a screen or input spawns in over the primary page
 * it gets it's own object to improve compartmentalisation and
 * readability.
 */
class InterestDropdownMenu {
    dropDownMenu = ".dropdown-menu"
    dropDownMenuItems = `.dropdown-item`

    /**
     * GETTERS
     */
    getDropDownMenu() {
        return cy.get(this.dropDownMenu).should('be.visible')
    }

    getInterestRate(rate: number) {
        return cy.get(this.dropDownMenuItems).contains(`${rate}%`)
    }

    openDropDownMenu() {
        return cy.get(this.dropDownMenu).click()
    }

    /**
     * FUNCTIONS
     */
    selectInterestRate(rate: number) {
        return cy.contains(this.dropDownMenuItems, `${rate}%`)
            .find('input[type="checkbox"]')
            .check({force: true})
    }

    isVisible(){
        cy.get(this.dropDownMenuItems).should('be.visible')
    }

    isNotVisible(){
        cy.get(this.dropDownMenuItems).should('be.not.visible')
    }
}


class calculationResults {
    interestAmount = "#interestAmount"
    totalAmount = '#totalAmount'

    /**
     * GETTERS
     */
    getInterestOutput() {
        return cy.get(this.interestAmount).should('be.visible')
    }

    getTotalOutput() {
        return cy.get(this.totalAmount).should('be.visible')
    }

    getInterestValue() {
        return this.getInterestOutput()
            .invoke('text')
            .then((text) => {
                return parseFloat(text.replace(/[^0-9.]/g, ''))
            })
    }
    getTotalValue(){
        return this.getTotalOutput()
            .invoke('text')
            .then((text) => {
                return parseFloat(text.replace(/[^0-9.]/g, ''))
            })
    }
}
