/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "FilterWindowControl.h"

#import "ControlConstants.h"
#import "NameValidator.h"
#import "NotifyingDictionary.h"

#import "FileItemTest.h"

#import "FilterTestRepository.h"
#import "Filter.h"
#import "NamedFilter.h"
#import "FilterTest.h"
#import "MutableFilterTestRef.h"

#import "FilterTestEditor.h"


NSString  *NameColumn = @"name";
NSString  *MatchColumn = @"match";


@interface FilterWindowControl (PrivateMethods)

@property (nonatomic, readonly, copy) NSArray *availableTests;

// Returns the non-localized name of the selected available test (if any).
@property (nonatomic, readonly, copy) NSString *selectedAvailableTestName;

// Returns the selected filter test (if any).
@property (nonatomic, readonly, strong) MutableFilterTestRef *selectedFilterTest;

// Returns NSNotFound when the test was not found
- (NSUInteger) indexOfTestInFilterNamed:(NSString *)name;

/* Helper method for creating FilterTests to be added to the filter. It sets the inverted and
 * canToggleInverted flags correctly.
 */
- (MutableFilterTestRef *)filterTestForTestNamed:(NSString *)name; 

- (void) testAddedToRepository:(NSNotification *)notification;
- (void) testRemovedFromRepository:(NSNotification *)notification;
- (void) testRenamedInRepository:(NSNotification *)notification;

- (void) updateWindowState:(NSNotification *)notification;
- (void) updateWindowTitle;

- (void) textEditingStarted:(NSNotification *)notification;
- (void) textEditingStopped:(NSNotification *)notification;

- (void) appDidUpdate:(NSNotification *)notification;

@property (nonatomic, getter=isNameKnownInvalid, readonly) BOOL nameKnownInvalid;

- (void) deleteTest:(NSString *)testName;

@end // @interface FilterWindowControl (PrivateMethods)


@implementation FilterWindowControl

- (instancetype) init {
  return [self initWithTestRepository: FilterTestRepository.defaultFilterTestRepository];
}

- (instancetype) initWithTestRepository:(FilterTestRepository *)testRepositoryVal {
  if (self = [super initWithWindow: nil]) {
    testRepository = [testRepositoryVal retain];
    NotifyingDictionary  *repositoryTestsByName = 
      [testRepository testsByNameAsNotifyingDictionary];

    NSNotificationCenter  *nc = repositoryTestsByName.notificationCenter;
    
    [nc addObserver: self
           selector: @selector(testAddedToRepository:)
               name: ObjectAddedEvent
             object: repositoryTestsByName];
    [nc addObserver: self
           selector: @selector(testRemovedFromRepository:)
               name: ObjectRemovedEvent
             object: repositoryTestsByName];
    [nc addObserver: self
           selector: @selector(testRenamedInRepository:)
               name: ObjectRenamedEvent
             object: repositoryTestsByName];

    filterName = nil;
    filterTests = [[NSMutableArray alloc] initWithCapacity: 8];

    availableTests =
      [[NSMutableArray alloc] initWithCapacity: testRepository.testsByName.count + 8];
    [availableTests addObjectsFromArray: testRepository.testsByName.allKeys];
    [availableTests sortUsingSelector: @selector(compare:)];

    testEditor = [[FilterTestEditor alloc] initWithFilterTestRepository: testRepository];
    
    nameValidator = nil;
    invalidName = nil;
       
    allowEmptyFilter = NO; // Default
  }
  return self;
}

- (void) dealloc {
  [testRepository.testsByNameAsNotifyingDictionary.notificationCenter removeObserver: self];
  [testRepository release];
  
  [NSNotificationCenter.defaultCenter removeObserver: self];

  [testEditor release];

  [filterName release];
  [filterTests release];
  [availableTests release];
  
  [nameValidator release];
  [invalidName release];

  [super dealloc];
}

- (NSString *)windowNibName {
  return @"FilterWindow";
}

- (void) windowDidLoad {
  filterTestsView.delegate = self;
  filterTestsView.dataSource = self;
  
  filterTestsView.target = self;
  filterTestsView.doubleAction = @selector(testDoubleClicked:);
  
  availableTestsView.delegate = self;
  availableTestsView.dataSource = self;
  
  [[filterTestsView tableColumnWithIdentifier: MatchColumn].dataCell
    setImageAlignment: NSImageAlignRight];
    
  [self updateWindowState: nil];
  
  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
  [nc addObserver: self
         selector: @selector(textEditingStarted:)
             name: NSTextDidBeginEditingNotification
           object: nil];
  [nc addObserver: self
         selector: @selector(textEditingStopped:)
             name: NSTextDidEndEditingNotification
           object: nil];

  [nc addObserver: self
         selector: @selector(appDidUpdate:)
             name: NSApplicationDidUpdateNotification
           object: nil];
}


- (void) setAllowEmptyFilter:(BOOL)flag {
  allowEmptyFilter = flag;
}

- (BOOL) allowEmptyFilter {
  return allowEmptyFilter;
}


- (void)windowDidBecomeKey:(NSNotification *)notification {
  finalNotificationFired = NO;

  NSResponder  *initialFirstResponder = nil;
  if (self.isNameKnownInvalid) {
    initialFirstResponder = filterNameField;
  }
  else if (filterTestsView.selectedRow != -1) {
    initialFirstResponder = filterTestsView;
  }
  else {
    initialFirstResponder = availableTestsView;
  }
  [self.window makeFirstResponder: initialFirstResponder];
}

- (void) windowWillClose:(NSNotification *)notification {
  if (! finalNotificationFired ) {
    // The window is closing while no "okPerformed" or "cancelPerformed" has been fired yet. This
    // means that the user is closing the window using the window's red close button.
    
    [NSNotificationCenter.defaultCenter postNotificationName: ClosePerformedEvent object: self];
  }
}


- (IBAction) cancelAction:(id)sender {
  NSAssert( !finalNotificationFired, @"Final notification already fired." );

  finalNotificationFired = YES;
  [NSNotificationCenter.defaultCenter postNotificationName: CancelPerformedEvent object: self];
}

- (IBAction) okAction:(id)sender {
  NSAssert( !finalNotificationFired, @"Final notification already fired." );

  // Check if the name of the test is okay.
  NSString  *errorMsg = [nameValidator checkNameIsValid: self.filterName];

  if (errorMsg != nil) {
    NSAlert *alert = [[[NSAlert alloc] init] autorelease];
  
    [alert addButtonWithTitle: OK_BUTTON_TITLE];
    alert.messageText = errorMsg;
    [alert beginSheetModalForWindow: self.window completionHandler: nil];

    [invalidName release];
    invalidName = [self.filterName retain];
  }
  else {
    finalNotificationFired = YES;
    [NSNotificationCenter.defaultCenter postNotificationName: OkPerformedEvent object: self];
  }
}


- (IBAction) filterNameChanged:(id)sender {
  [self updateWindowTitle];
  [self updateWindowState: nil];
}


- (IBAction) removeTestFromRepository:(id)sender {
  NSString  *testName = [self selectedAvailableTestName];
  
  NSAlert  *alert = [[[NSAlert alloc] init] autorelease];

  NSString  *fmt = NSLocalizedString(@"Remove the test named \"%@\"?", @"Alert message");
  NSString  *infoMsg = 
    ([testRepository applicationProvidedTestForName: testName] != nil)
    ? NSLocalizedString(@"The test will be replaced by the default test with this name",
                        @"Alert informative text")
    : NSLocalizedString(@"The test will be irrevocably removed from the test repository",
                        @"Alert informative text");

  NSString  *localizedName =
    [NSBundle.mainBundle localizedStringForKey: testName value: nil table: @"Names"];
  
  [alert addButtonWithTitle: REMOVE_BUTTON_TITLE];
  [alert addButtonWithTitle: CANCEL_BUTTON_TITLE];
  alert.messageText = [NSString stringWithFormat: fmt, localizedName];
  alert.informativeText = infoMsg;

  [alert beginSheetModalForWindow: self.window completionHandler:^(NSModalResponse returnCode) {
    if (returnCode == NSAlertFirstButtonReturn) {
      [self deleteTest: testName];
    }
  }];
}


- (IBAction) addTestToRepository:(id)sender {
  FilterTest  *newTest = [testEditor createFilterTest];

  if (newTest != nil) {
    NSUInteger  index = [availableTests indexOfObject: newTest.name];
    [availableTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                    byExtendingSelection: NO];
    [self.window makeFirstResponder: availableTestsView];
    [self updateWindowState: nil];
  }
}


- (IBAction) editTestInRepository:(id)sender {
  [testEditor editFilterTestNamed: self.selectedAvailableTestName];
}


- (IBAction) addTestToFilter:(id)sender {
  NSString  *testName = self.selectedAvailableTestName;

  if (testName != nil) {
    FilterTestRef  *filterTest = [self filterTestForTestNamed: testName];
    NSAssert(filterTest != nil, @"Test not found in repository.");
        
    [filterTests addObject: filterTest];
    
    [filterTestsView reloadData];
    [availableTestsView reloadData];
    
    // Select the newly added test.
    NSUInteger  index = [filterTests indexOfObject: filterTest];
    [filterTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                 byExtendingSelection: NO];
    [self.window makeFirstResponder: filterTestsView];

    [self updateWindowState: nil];
  }
}

- (IBAction) removeTestFromFilter:(id)sender {
  NSInteger  index = filterTestsView.selectedRow;
  
  if (index >= 0) {
    NSString  *testName = [filterTests[index] name];
    
    [filterTests removeObjectAtIndex: index];

    [filterTestsView reloadData];
    [availableTestsView reloadData];
    
    // Select the test in the repository (if it still exists there)
    NSUInteger  index = [availableTests indexOfObject: testName];
    if (index != NSNotFound) {
      [availableTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                      byExtendingSelection: NO];
      [self.window makeFirstResponder: availableTestsView];
    }
    
    [self updateWindowState: nil];
  }
}

- (IBAction) removeAllTestsFromFilter:(id)sender {
  [filterTests removeAllObjects];
  
  [filterTestsView reloadData];
  [availableTestsView reloadData];

  [self updateWindowState: nil];
}

- (IBAction) testDoubleClicked:(id)sender {
  MutableFilterTestRef  *filterTest = [self selectedFilterTest];
  if (filterTest != nil && [filterTest canToggleInverted]) {
    [filterTest toggleInverted];
    [filterTestsView reloadData];
  }
}


//----------------------------------------------------------------------------
// NSTableSource

- (NSInteger) numberOfRowsInTableView:(NSTableView *)tableView {
  if (tableView == filterTestsView) {
    return filterTests.count;
  }
  else if (tableView == availableTestsView) {
    return availableTests.count;
  }
  else {
    NSAssert(NO, @"Unexpected sender.");
    return 0;
  }
}

- (id) tableView:(NSTableView *)tableView objectValueForTableColumn:(NSTableColumn *)column
             row:(NSInteger)row {
  NSBundle  *mainBundle = NSBundle.mainBundle;

  if (tableView == filterTestsView) {
    FilterTestRef  *filterTest = filterTests[row];

    if ([column.identifier isEqualToString: NameColumn]) {
      return [mainBundle localizedStringForKey: filterTest.name value: nil table: @"Names"];
    }
    else if ([column.identifier isEqualToString: MatchColumn]) {
      return [NSImage imageNamed: filterTest.isInverted ? @"Cross" : @"Checkmark"];
    }
    else {
      NSAssert(NO, @"Unknown column.");
    }
  }
  else if (tableView == availableTestsView) {
    NSString  *name = availableTests[row];
    return [mainBundle localizedStringForKey: name value: nil table: @"Names"];
  }
  NSAssert(NO, @"Unknown tableView.");
  return nil;
}


//-----------------------------------------------------------------------------
// Delegate methods for NSTableView

- (void) tableView:(NSTableView *)tableView
   willDisplayCell:(id)cell
    forTableColumn:(NSTableColumn *)column
               row:(NSInteger)row {
  if (tableView == availableTestsView) {
    NSString  *name = availableTests[row];

    [cell setEnabled: [self indexOfTestInFilterNamed: name] == NSNotFound];
  }
}

- (NSString *)tableView:(NSTableView *)tableView
         toolTipForCell:(NSCell *)cell
                   rect:(NSRectPointer)rect
            tableColumn:(NSTableColumn *)tableColumn
                    row:(NSInteger)row
          mouseLocation:(NSPoint)mouseLocation {
  NSString  *name = nil;
  if (tableView == filterTestsView) {
    name = ((MutableFilterTestRef *)filterTests[row]).name;
  }
  else if (tableView == availableTestsView) {
    name = availableTests[row];
  }

  if (name != nil) {
    FileItemTest  *selectedTest = testRepository.testsByName[name];
    return selectedTest.description;
  }
  else {
    return @"";
  }
}

- (void) tableViewSelectionDidChange:(NSNotification *)notification {
  [self updateWindowState: nil];
}


- (NSString *)filterName {
  if (filterNameField.enabled) {
    // No fixed "visible" name was set, so get the name from the text field.
    return filterNameField.stringValue;
  }
  else {
    // The test name field was showing the test's visible name. Return its original name.
    return filterName;
  }
}


- (void) setNameValidator:(NSObject<NameValidator> *)validator {
  if (validator != nameValidator) {
    [nameValidator release];
    nameValidator = [validator retain];
  }
}


- (void) representEmptyFilter {
  NamedFilter  *emptyFilter = [NamedFilter emptyFilterWithName: @""];
  [self representNamedFilter: emptyFilter];
}


// Configures the window to represent the given filter.
- (void) representNamedFilter:(NamedFilter *)namedFilter {
  NSAssert(namedFilter != nil, @"Filter should not be nil.");

  Filter  *filter = namedFilter.filter;
  [filterTests removeAllObjects];
  
  NSUInteger  i = 0;
  NSUInteger  max = filter.numFilterTests;
  while (i < max) {
    FilterTestRef  *orgFilterTest = [filter filterTestAtIndex: i];
    NSString  *name = orgFilterTest.name;
    
    MutableFilterTestRef  *newFilterTest = [self filterTestForTestNamed: name];
    if (newFilterTest != nil) {
      if ( newFilterTest.canToggleInverted &&
           newFilterTest.isInverted != orgFilterTest.isInverted ) {
        [newFilterTest toggleInverted];
      }
    
      [filterTests addObject: newFilterTest];
    }
    else {
      NSLog(@"Test \"%@\" does not exist anymore in repository.", name);

      // Simply omit it.
    }

    i++;
  }
  
  [filterTestsView reloadData];
  [availableTestsView reloadData];
  
  if (filterName != namedFilter.name) {
    [filterName release];
    filterName = [namedFilter.name retain];
  }
  filterNameField.stringValue = filterName;
  [filterNameField setEnabled: YES];

  // Forget about any previously reported invalid names.
  [invalidName release];
  invalidName = nil;

  [self updateWindowTitle];
  [self updateWindowState: nil];
}

// Returns the filter that represents the current window state.
- (NamedFilter *)createNamedFilter {
  Filter  *filter = [Filter filterWithFilterTests: filterTests];
  return [NamedFilter namedFilter: filter name: self.filterName];
}


- (void) setVisibleName:(NSString *)name {
  filterNameField.stringValue = name;
  [filterNameField setEnabled: NO];
  [self updateWindowTitle];
}

@end // @implementation FilterWindowControl


@implementation FilterWindowControl (PrivateMethods)

- (NSArray *)availableTests {
  return availableTests;
}

// Returns the non-localized name of the selected available test (if any).
- (NSString *)selectedAvailableTestName {
  NSInteger  index = availableTestsView.selectedRow;
  
  return (index < 0) ? nil : availableTests[index];
}

// Returns the selected filter test (if any).
- (MutableFilterTestRef *)selectedFilterTest {
  NSInteger  index = filterTestsView.selectedRow;
  
  return (index < 0) ? nil : filterTests[index];
}

- (NSUInteger) indexOfTestInFilterNamed:(NSString *)name {
  NSUInteger  i = filterTests.count;

  while (i-- > 0) {
    if ([[filterTests[i] name] isEqualToString: name]) {
      return i;
    }
  }
  
  return NSNotFound;
}


- (MutableFilterTestRef *)filterTestForTestNamed:(NSString *)name {
  FileItemTest  *test = testRepository.testsByName[name];

  if (test == nil) {
    return nil;
  }

  MutableFilterTestRef  *filterTest =
    [[[MutableFilterTestRef alloc] initWithName: name] autorelease];

  if (test.appliesToDirectories) {
    // Fix "inverted" state of the filter test. 
    
    if (! [filterTest isInverted]) {
      [filterTest setCanToggleInverted: YES]; // Not needed, but no harm.
      [filterTest toggleInverted];
    }
    [filterTest setCanToggleInverted: NO];
  }
  
  return filterTest;
}


- (void) testAddedToRepository:(NSNotification *)notification { 
  NSString  *testName = notification.userInfo[@"key"];
  NSString  *selectedName = self.selectedAvailableTestName;

  [availableTests addObject: testName];
  // Ensure that the tests remain sorted.
  [availableTests sortUsingSelector: @selector(compare:)];
  [availableTestsView reloadData];
        
  if (selectedName != nil) {
    // Make sure that the same test is still selected.
    NSUInteger  index = [availableTests indexOfObject: selectedName];
    [availableTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                    byExtendingSelection: NO];
  }
                
  [self updateWindowState: nil];
}


- (void) testRemovedFromRepository:(NSNotification *)notification {
  NSString  *testName = notification.userInfo[@"key"];
  NSString  *selectedName = self.selectedAvailableTestName;

  NSUInteger  index = [availableTests indexOfObject: testName];
  NSAssert(index != NSNotFound, @"Test not found in available tests.");

  [availableTests removeObjectAtIndex:index];
  [availableTestsView reloadData];
  
  if ([testName isEqualToString: selectedName]) {
    // The removed test was selected. Clear the selection.
    [availableTestsView deselectAll: self];
  }
  else if (selectedName != nil) {
    // Make sure that the same test is still selected. 
    index = [availableTests indexOfObject: selectedName];
    [availableTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                    byExtendingSelection: NO];
  }

  [self updateWindowState: nil];
}


- (void) testRenamedInRepository:(NSNotification *)notification {
  NSString  *oldTestName = notification.userInfo[@"oldkey"];
  NSString  *newTestName = notification.userInfo[@"newkey"];

  NSUInteger  index = [availableTests indexOfObject: oldTestName];
  NSAssert(index != NSNotFound, @"Test not found in available tests.");

  NSString  *selectedName = [self selectedAvailableTestName];

  availableTests[index] = newTestName;
  // Ensure that the tests remain sorted.
  [availableTests sortUsingSelector: @selector(compare:)];
  [availableTestsView reloadData];
    
  if ([selectedName isEqualToString: oldTestName]) {
    // It was selected, so make sure it still is.
    selectedName = newTestName;
  }
  if (selectedName != nil) {
    // Make sure that the same test is still selected.
    index = [availableTests indexOfObject: selectedName];
    [availableTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index] 
                    byExtendingSelection: NO];
  }
}


- (void) updateWindowState:(NSNotification *)notification {
  FilterTestRef  *selectedFilterTest = self.selectedFilterTest;
  NSString  *selectedAvailableTestName = self.selectedAvailableTestName;

  if (selectedAvailableTestName != nil) {
    NSUInteger  index = [self indexOfTestInFilterNamed: selectedAvailableTestName];
      
    if (index != NSNotFound) {
      // The window is in an anomalous situation: a test is selected in the available tests view,
      // even though the test is used in the filter.
      //
      // This anomalous situation can occur as follows:
      // 1. Create a mask, and press OK (to apply it and close the window).
      // 2. Edit the mask. Remove one of the tests from the filter, but now press Cancel (so that
      //    the mask remains unchanged, yet the window closes)
      // 3. Edit the mask again. Now the focus will still be on the test in the available test
      //    window that had been moved in Step 2. However, as this change was undone by cancelling
      //    the mask, the test is actually not available and thus disabled.
    
      // Select the disabled test in the other view. 
      [filterTestsView selectRowIndexes: [NSIndexSet indexSetWithIndex: index]
                   byExtendingSelection: NO];

      [availableTestsView deselectAll: nil];
      selectedAvailableTestName = nil;

      [self.window makeFirstResponder: filterTestsView];
    }
  }

  firstResponder = self.window.firstResponder;
  BOOL  filterTestsHighlighted = (firstResponder == filterTestsView);
  BOOL  availableTestsHighlighted = ( firstResponder == availableTestsView );

  // Find out which test (if any) is currently highlighted.
  NSString  *selectedTestName = nil;

  if (filterTestsHighlighted) {
    selectedTestName = selectedFilterTest.name;
  }
  else if (availableTestsHighlighted) {
    selectedTestName = selectedAvailableTestName;
  }
  
  FileItemTest  *selectedTest = testRepository.testsByName[selectedTestName];

  // Update enabled status of buttons with context-dependent actions.
  BOOL  availableTestHighlighted = selectedAvailableTestName != nil && availableTestsHighlighted;

  editTestInRepositoryButton.enabled = availableTestHighlighted;
  // Cannot remove an application-provided test (it would automatically re-appear anyway).
  removeTestFromRepositoryButton.enabled = (
    availableTestHighlighted &&
    selectedTest != [testRepository applicationProvidedTestForName: selectedAvailableTestName]
  );

  addTestToFilterButton.enabled = availableTestHighlighted;
  removeTestFromFilterButton.enabled = selectedFilterTest != nil && filterTestsHighlighted;

  BOOL  nonEmptyFilter = filterTests.count > 0;

  removeAllTestsFromFilterButton.enabled = nonEmptyFilter;
  okButton.enabled = (nonEmptyFilter || allowEmptyFilter) && !self.isNameKnownInvalid;
}

- (void) updateWindowTitle {
  NSString  *name = filterNameField.stringValue;
  NSString  *title;
  if (name == nil || name.length == 0) {
    title = NSLocalizedString(@"Unnamed filter", @"Window title");
  }
  else {
    NSString  *format = NSLocalizedString(@"Filter - %@", @"Window title");
    title = [NSString stringWithFormat: format, name];
  }
  self.window.title = title;
}


- (void) textEditingStarted:(NSNotification *)notification {
  NSWindow  *window = self.window;
  BOOL  nameFieldIsFirstResponder =
    ( [window.firstResponder isKindOfClass: [NSTextView class]] &&
      [window fieldEditor: NO forObject: nil] != nil &&
      ((NSTextView *)window.firstResponder).delegate == (id)filterNameField );

  if (nameFieldIsFirstResponder) { 
    // Disable Return key equivalent for OK button while editing is in progress. When the field is
    // non-empty, Return should signal the end of the edit session and enable the OK button, but not
    // directly invoke it.
    okButton.keyEquivalent = @"";
  }
}

- (void) textEditingStopped:(NSNotification *)notification {
  // Reenable the Return key equivalent again. It is done after a short delay as otherwise it will
  // still handle the Return key press that may have triggered this event.
  [okButton performSelector: @selector(setKeyEquivalent:)
                 withObject: @"\r"
                 afterDelay: 0.1
                    inModes: @[NSModalPanelRunLoopMode, NSDefaultRunLoopMode]];
}


- (void) appDidUpdate:(NSNotification *)notification {
  // We want to detect when one of the filter views is newly selected (i.e. became first responder)
  // so that the description of the selected filter can be updated. Apparently there are no events
  // signalling first responder changes, so doing it a bit more brute force.
  if (self.window.firstResponder != firstResponder) {
    [self updateWindowState: notification];
  }
}


- (BOOL) isNameKnownInvalid {
  NSString  *currentName = filterNameField.stringValue;
  return currentName.length == 0 || [currentName isEqualToString: invalidName];
}


- (void) deleteTest:(NSString *)testName {
  FileItemTest  *defaultTest = [testRepository applicationProvidedTestForName: testName];
  NotifyingDictionary  *repositoryTestsByName = testRepository.testsByNameAsNotifyingDictionary;

  if (defaultTest == nil) {
    [repositoryTestsByName removeObjectForKey: testName];
  } else {
    // Replace it by the application-provided test with the same name (this would happen anyway
    // when the application is restarted).
    [repositoryTestsByName updateObject: defaultTest forKey: testName];
  }

  // Rest of delete handled in response to notification event.
}

@end // @implementation FilterWindowControl (PrivateMethods)
