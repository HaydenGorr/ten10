import { access } from "../fixtures/fixture_interfaces";
import { numericalData } from "../fixtures/testData";
import { InterestCalculator } from "../pages/interestCalculator";
import { LoginPage } from "../pages/loginPage"

describe('meeting requirements', () => {

  const loginPage = new LoginPage();
  const interestCalculator = new InterestCalculator();

  beforeEach(() => {
    cy.fixture('access').then(((data: access) => {
      cy.visit(data.login_url)
      loginPage.getEmailInput().type(data.email)
      loginPage.getPasswordInput().type(data.password)
      loginPage.getLoginButton().click()
    } ))
  })

  it('Calculation accuracy', () => {
    /**
     * Test boundary values for principal slider
     */
    interestCalculator.inputValueInPrincipalSlider(15001)
    interestCalculator.getSelectedPrincipleValue().should('have.text', '15000')

    interestCalculator.inputValueInPrincipalSlider(-1)
    interestCalculator.getSelectedPrincipleValue().should('have.text', '0')


    /**
     * Core functionality
     */
    numericalData.forEach((data) =>{

      // Handle Principal input
      interestCalculator.inputValueInPrincipalSlider(data.principal)
      interestCalculator.getSelectedPrincipleValue().should('have.text', data.principal)

      // Handle interest input
      interestCalculator.toggleDropdownMenu()
      interestCalculator.interestDropdownMenu.isVisible()
      interestCalculator.interestDropdownMenu.selectInterestRate(data.rate)
      cy.get('body').click(0, 0) // hide the dropdown
      interestCalculator.interestDropdownMenu.isNotVisible()


      // Handle duration selection
      interestCalculator.clickDuration(data.duration)
      
      // Check Mandatory Consent
      interestCalculator.getMandatoryConsentCheckbox().check();

      // Click Calculate
      interestCalculator.getCalculateButton().click();

      // Compare Results
      interestCalculator.calculationResults.getInterestValue().should('equal', data.expectedInterest)
      interestCalculator.calculationResults.getTotalValue().should('equal', data.expectedAmount)
    })
    

})
})


