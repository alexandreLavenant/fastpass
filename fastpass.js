#!/usr/bin/env node

const puppeteer = require('puppeteer'),
	program = require('commander'),
	$ = require('cheerio'),
	bookTicket = async function(browser, zepassId)
	{
		if (pageCommon === null) {
			pageCommon = await browser.newPage();
		}

		const response = await pageCommon.goto(`https://www.zepass.com/panier/ajout/annonce/${zepassId}/quantite/1`),
			status = response.status(),
			body = await response.text(),
			$info = $(body).find('#info-ajout'),
			$valid = $info.find('.valid')
			;

		var infoText = $info.text().trim();
		if (status === 500) {
			infoText = 'Erreur 500';
			count500++;
			// Save zepass Id of the first 500
			if (count500 === 1) {
				first500Id = zepassId;
			}
			
			console.info(`${zepassId}: ${infoText}`);
			// If we have more than 3 500 in a row
			// it means that there is no ticket for the moment
			// so wait a bit and try until there is a ticket
			if (count500 > 3) {
				await sleep(2e3);
				count500 = 0;
				return bookTicket(browser, first500Id);
			}

			// Continue to try it with the next one
			return bookTicket(browser, ++zepassId);
		}

		if ($valid.length === 1) {
			infoText = $valid.text().trim();
		}

		console.info(`${zepassId}: ${infoText}`);

		if (infoText === 'Vous avez trop d\'éléments dans votre panier.') {
			const foundTicket = await deleteTicketsBooked(browser);

			if (!foundTicket) {
				return bookTicket(browser, zepassId);
			}

			return seeTicketsBooked(browser);
		}

		if (
			infoText === 'Cette annonce n\'est malheureusement plus disponible.' ||
			infoText === 'Il n\'y a plus de billet disponible pour cette annonce.' ||
			infoText === 'Les billets de cette annonce sont vendus de façon indissociable, vous ne pouvez donc pas modifier la quantité sur cette annonce.' ||
			infoText === 'Le billet a bien été ajouté à votre panier'||
			infoText === 'Vous ne pouvez pas ajouter ce billet dans votre panier.'
		) {
			count500 = 0;
			first500Id = null;
			return bookTicket(browser, ++zepassId);
		}
	},
	deleteTicketsBooked = async function(browser)
	{
		const $tickets = await getTicketsBooked(browser),
			promisesDelete = []
			;

		var numberDeleted = 0;
		$tickets.each(async function() {
			const ticketTitle = $(this).find('.titre-annonce').text().trim();
			
			if (regexTitle.test(ticketTitle) === false) {
				const ticketId = $(this).attr('id').replace('annonce_', '');
				promisesDelete.push(
					deleteTicketBooked(browser, ticketId, ticketTitle).then(() => numberDeleted ++)
				);
			}
		});

		await Promise.all(promisesDelete);
		// We didn't find any ticket we wanted, continue
		if ($tickets.length - numberDeleted === 0) {
			return Promise.resolve(false);
		}

		return Promise.resolve(true);
	},
	getTicketsBooked = async function(browser)
	{
		const response = await pageCommon.goto('https://www.zepass.com/panier/panier'),
			body = await response.text(),
			$table = $(body).find('#panier-content')
			;

		return $table.find('tbody tr');
	},
	deleteTicketBooked = async function(browser, ticketId, ticketTitle)
	{
		console.info(`${ticketId}: Deleting ${ticketTitle}`);
		const page = await browser.newPage();
		await page.goto(`https://www.zepass.com/panier/supprimer_annonce/annonce/${ticketId}`);

		return page.close();
	},
	seeTicketsBooked = async function(browser)
	{
		console.info('We found some tickets for you');
		await pageCommon.close();
		pageCommon = null;

		const page = await browser.newPage();
		return page.goto('https://www.zepass.com/panier/panier');
	},
	sleep = function(ms)
	{
		return new Promise(resolve => setTimeout(resolve, ms));
	},
	numberPool = 1,
	promisesPool = []
	;
	
program
	.usage('-z <zepassId ...> -t <ticketName ...>')
	.version(require('./package.json').version, '-v, --version')
	.option('-z, --zepassId <id>', 'Zepass id', parseInt)
	.option('-t, --ticket <name>', 'Ticket you want ex:Hellfest')
	.parse(process.argv)
	;

var pageCommon = null,
	count500 = 0,
	first500Id = null,
	regexTitle = new RegExp('.*' + (program.ticket || '') + '.*', 'mi')
	;

puppeteer.launch({ headless: false })
.then(async browser =>
{
	for(let i = 0; i < numberPool; i++) {
		promisesPool.push(bookTicket(browser, (program.zepassId || '987766')));
	}
		
	await Promise.all(promisesPool);
});