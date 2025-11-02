


export class LoginPage {
    textInputEmail = "input#UserName"
    textInputPassword = "input#Password"
    buttonLogin = "button#login-submit"

    getEmailInput() {
        return cy.get(this.textInputEmail)
    }
    getPasswordInput() {
        return cy.get(this.textInputPassword)
    }
    getLoginButton() {
        return cy.get(this.buttonLogin)
    }
    
}
